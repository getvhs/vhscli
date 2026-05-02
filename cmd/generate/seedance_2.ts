import { Command, InvalidArgumentError, Option } from "commander"
import { z } from "zod"
import { die } from "../../lib/error.js"
import { save_media } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/seedance_2.js"
import { task2 } from "../../lib/schema/task2.js"
import { type Session } from "../../lib/session.js"
import { submit } from "../../lib/submit.js"
import { pg_get, upload_file, upload_image } from "../../lib/supabase.js"
import { save_t3_seedance_2_result, submit_and_poll_t3, translate_seedance_2_to_t3 } from "../../lib/t3.js"
import { zparse } from "../../lib/util.js"
import { get_session } from "../session.js"

type Payload = z.infer<typeof schema.request>

const ratios = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]
const resolutions = ["480p", "720p", "1080p"]

type Opts = {
  output?: string
  firstFrame?: string
  lastFrame?: string
  image?: string[]
  video?: string[]
  audio?: string[]
  silent?: boolean
  ratio?: string
  resolution?: string
  duration?: number
  seed?: number
}

export function register(program: Command) {
  program.command("seedance-2")
    .description("generate a video with seedance 2.0")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-seedance-2-<timestamp>.mp4)")
    .option("--first-frame <image>", "use as the first frame")
    .option("--last-frame <image>", "use as the last frame (needs --first-frame)")
    .option("-i, --image <path>", "reference image (max 9, repeat -i for more). conflicts with --first-frame", collect)
    .option("-v, --video <path>", "reference video (max 3, repeat -v for more)", collect)
    .option("-a, --audio <path>", "reference audio (max 3, repeat -a for more). needs -i or -v", collect)
    .addOption(new Option("--ratio <ratio>", "aspect ratio (default: adaptive)").choices(ratios))
    .addOption(new Option("--resolution <res>", "video resolution (default: 720p)").choices(resolutions))
    .option("--duration <n>", "video length in seconds: 4-15, or -1 for auto (default: 5)", parse_duration)
    .option("--silent", "make a silent video")
    .option("--seed <n>", "random seed for reproducible output", parse_seed)
    .showHelpAfterError("(run 'vhscli generate seedance-2 --help' for usage)")
    .addHelpText("after", `
generates a short video from a text prompt and saves an .mp4 to the
current folder. videos can take minutes; keep the task id and run
'vhscli resume <task_id>' if you stop the command.

examples:
  vhscli generate seedance-2 "a woman in a red dress walks through a rainy neon-lit alley, slow tracking shot"
  vhscli generate seedance-2 "animate this photo: gentle pan to the right" --first-frame photo.jpg`)
    .action(run)
}

async function run(prompt_arg: string, opts: Opts) {
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const output = opts.output ?? null
  const { task_id, err } = await submit(sess, "byteplus:seedance-2-0", payload, "generating video...", 20_000)
  // byteplus can reject synchronously (e.g. real-face filter); the async
  // callback path also surfaces err in save() below.
  if (err) {
    if (should_t3_fallback(payload, err)) {
      await run_t3_fallback(sess, payload, output)
      return
    }
    die(err)
  }
  await save(sess, task_id, payload, output)
}

async function parse_opts(sess: Session, prompt_arg: string, opts: Opts) {
  const prompt = await read_prompt(prompt_arg)
  const images = opts.image ?? []
  const videos = opts.video ?? []
  const audios = opts.audio ?? []

  if (opts.lastFrame && !opts.firstFrame) die("--last-frame requires --first-frame")
  if (opts.firstFrame && images.length > 0) die("--first-frame conflicts with -i")
  if (audios.length > 0 && images.length === 0 && videos.length === 0) die("-a requires -i or -v")
  if (images.length > 9) die("-i accepts at most 9 images")
  if (videos.length > 3) die("-v accepts at most 3 videos")
  if (audios.length > 3) die("-a accepts at most 3 audios")

  const content: Record<string, unknown>[] = [{ type: "text", text: prompt }]
  const upload_img = async (path: string) => {
    console.log(`uploading ${path}...`)
    return (await upload_image(sess, path)).url
  }
  const upload_av = async (path: string) => {
    console.log(`uploading ${path}...`)
    return upload_file(sess, path)
  }

  if (opts.firstFrame) {
    content.push({ type: "image_url", image_url: { url: await upload_img(opts.firstFrame) }, role: "first_frame" })
    if (opts.lastFrame) content.push({ type: "image_url", image_url: { url: await upload_img(opts.lastFrame) }, role: "last_frame" })
  } else {
    for (const img of images) content.push({ type: "image_url", image_url: { url: await upload_img(img) }, role: "reference_image" })
    for (const video of videos) content.push({ type: "video_url", video_url: { url: await upload_av(video) }, role: "reference_video" })
    for (const audio of audios) content.push({ type: "audio_url", audio_url: { url: await upload_av(audio) }, role: "reference_audio" })
  }

  const payload: Record<string, unknown> = { model: "dreamina-seedance-2-0-260128", content }
  if (opts.resolution) payload.resolution = opts.resolution
  if (opts.ratio) payload.ratio = opts.ratio
  if (opts.duration != null) payload.duration = opts.duration
  if (opts.silent) payload.generate_audio = false
  if (opts.seed != null) payload.seed = opts.seed

  return zparse(schema.request, payload, "bad seedance-2 payload")
}

export async function save(sess: Session, task_id: string, payload: Payload, output: string | null) {
  let dotted = false
  const finish_dots = () => { if (dotted) process.stdout.write("\n") }
  while (true) {
    const data = await pg_get(sess, "task2", "result, err", task_id)
    if (!data) {
      finish_dots()
      die(`task disappeared: ${task_id}`)
    }
    const row = zparse(task2, data, "bad task2 row")
    if (row.err) {
      finish_dots()
      if (should_t3_fallback(payload, row.err)) {
        await run_t3_fallback(sess, payload, output)
        return
      }
      die(row.err)
    }
    if (row.result) {
      finish_dots()
      const url = zparse(schema.response, row.result, "bad seedance-2 response").content.video_url
      await save_media(url, output, "seedance-2")
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    process.stdout.write(".")
    dotted = true
  }
}

function should_t3_fallback(payload: Payload, err: string): boolean {
  const has_images = payload.content.some((c) => c.type === "image_url")
  return has_images && err.includes("InputImageSensitiveContentDetected.PrivacyInformation")
}

async function run_t3_fallback(sess: Session, payload: Payload, output: string | null) {
  console.log("input image contains a real face; falling back to t3-seedance-2 with face referencing...")
  const t3_payload = await translate_seedance_2_to_t3(sess, payload)
  const t3_result = await submit_and_poll_t3(sess, t3_payload)
  await save_t3_seedance_2_result(t3_result, output)
}

function parse_duration(value: string) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new InvalidArgumentError("must be an integer")
  if (n !== -1 && (n < 4 || n > 15)) throw new InvalidArgumentError("must be 4-15, or -1")
  return n
}

function parse_seed(value: string) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new InvalidArgumentError("must be an integer")
  return n
}

function collect(val: string, prev: string[] | undefined) {
  return prev ? [...prev, val] : [val]
}
