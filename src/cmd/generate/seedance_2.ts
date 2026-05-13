import { Command, InvalidArgumentError, Option } from "commander"
import { z } from "zod"
import { die } from "../../lib/error.js"
import { default_output, save_media, validate_output } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/simple.js"
import { get_session, type Session } from "../../lib/session.js"
import { create_and_submit, type Mode } from "../../lib/task.js"
import { upload_image } from "../../lib/media.js"
import { upload_file } from "../../lib/storage.js"
import { media_to_assets, wait_for_t3_task } from "../../lib/t3.js"
import { kparse } from "../../lib/parse.js"
import { remove_vhs_task, write_vhs_task } from "../../lib/vhs_task.js"

type Payload = z.infer<typeof schema.simple_video_request>

const ratios = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]
const resolutions = ["480p", "720p", "1080p"]

type Opts = {
  output?: string
  firstFrame?: string
  lastFrame?: string
  i?: string[]
  v?: string[]
  a?: string[]
  audio: boolean
  ratio?: string
  resolution?: string
  duration?: number
}

export function register(parent: Command, mode: Mode) {
  parent.command("seedance-2")
    .description(mode === "submit" ? "submit a seedance 2.0 video task" : "generate a video with seedance 2.0")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-seedance-2-<timestamp>.mp4)")
    .option("--first-frame <image>", "use as the first frame")
    .option("--last-frame <image>", "use as the last frame (needs --first-frame)")
    .option("-i <path>", "reference image (max 9, repeat -i for more). conflicts with --first-frame", collect)
    .option("-v <path>", "reference video (max 3, repeat -v for more)", collect)
    .option("-a <path>", "reference audio (max 3, repeat -a for more). needs -i or -v", collect)
    .addOption(new Option("--ratio <ratio>", "aspect ratio (default: 16:9)").choices(ratios))
    .addOption(new Option("--resolution <res>", "video resolution (default: 720p)").choices(resolutions))
    .option("--duration <n>", "video length in seconds: 4-15 (default: 5)", parse_duration)
    .option("--audio", "include audio in output (default)", true)
    .option("--no-audio", "make a silent video")
    .showHelpAfterError(`(run 'vhscli ${mode} seedance-2 --help' for usage)`)
    .addHelpText("after", `
generates a short video from a text prompt and saves an .mp4 to the
current folder. videos can take minutes; if you stop the command, run
'vhscli resume <output>.vhs_task' to wait for it.

examples:
  vhscli ${mode} seedance-2 "a woman in a red dress walks through a rainy neon-lit alley, slow tracking shot"
  vhscli ${mode} seedance-2 "animate this photo: gentle pan to the right" --first-frame photo.jpg`)
    .action((prompt_arg, opts) => run(prompt_arg, opts, mode))
}

async function run(prompt_arg: string, opts: Opts, mode: Mode) {
  validate_output(opts.output, "video")
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const output = opts.output ?? default_output("seedance-2", "mp4")
  const task_id = await create_and_submit(sess, "a1:t3:seedance2", payload)
  await write_vhs_task(output, task_id)
  if (mode === "submit") return
  console.log("generating video...")
  const { result, err } = await wait_for_t3_task(sess, task_id)
  // t3 forwards to byteplus, which rejects real-face content; retry once
  // through t3 virtual-portrait assets.
  if (err) {
    if (is_privacy_error(err)) {
      await retry_with_assets(sess, payload, output)
      return
    }
    await remove_vhs_task(output)
    die(err)
  }
  await save(result, output)
  await remove_vhs_task(output)
}

async function parse_opts(sess: Session, prompt_arg: string, opts: Opts) {
  const prompt = await read_prompt(prompt_arg)
  const images = opts.i ?? []
  const videos = opts.v ?? []
  const audios = opts.a ?? []

  if (opts.lastFrame && !opts.firstFrame) die("--last-frame requires --first-frame")
  if (opts.firstFrame && images.length > 0) die("--first-frame conflicts with -i")
  if (audios.length > 0 && images.length === 0 && videos.length === 0) die("-a requires -i or -v")
  if (images.length > 9) die("-i accepts at most 9 images")
  if (videos.length > 3) die("-v accepts at most 3 videos")
  if (audios.length > 3) die("-a accepts at most 3 audios")

  const upload_img = async (path: string) => {
    console.log(`uploading ${path}...`)
    return (await upload_image(sess, path)).url
  }
  const upload_av = async (path: string) => {
    console.log(`uploading ${path}...`)
    return upload_file(sess, path)
  }

  const payload: Record<string, unknown> = {
    prompt,
    duration: opts.duration ?? 5,
    output_audio: opts.audio,
    resolution: opts.resolution ?? "720p",
    ratio: opts.ratio ?? "16:9",
  }

  if (opts.firstFrame) {
    payload.first_frame = await upload_img(opts.firstFrame)
    if (opts.lastFrame) payload.last_frame = await upload_img(opts.lastFrame)
  } else if (images.length > 0) {
    const urls: string[] = []
    for (const img of images) urls.push(await upload_img(img))
    payload.input_image = urls
  }

  if (videos.length > 0) {
    const urls: string[] = []
    for (const v of videos) urls.push(await upload_av(v))
    payload.input_video = urls
  }
  if (audios.length > 0) {
    const urls: string[] = []
    for (const a of audios) urls.push(await upload_av(a))
    payload.input_audio = urls
  }

  return kparse(schema.simple_video_request, payload, "bad seedance-2 payload")
}

export async function save(result: unknown, output: string | null) {
  const r = kparse(schema.simple_video_response, result, "bad seedance-2 response")
  await save_media(r.video_url, output, "seedance-2")
}

function is_privacy_error(err: string): boolean {
  return err.includes("InputImageSensitiveContentDetected.PrivacyInformation") ||
    err.includes("InputVideoSensitiveContentDetected.PrivacyInformation")
}

async function retry_with_assets(sess: Session, payload: Payload, output: string) {
  console.log("input contains real-face content; retrying via t3 virtual-portrait assets...")
  const asset_payload = await media_to_assets(sess, payload)
  const task_id = await create_and_submit(sess, "a1:t3:seedance2", asset_payload)
  await write_vhs_task(output, task_id)
  console.log("regenerating video...")
  const { result, err } = await wait_for_t3_task(sess, task_id)
  if (err) {
    await remove_vhs_task(output)
    die(err)
  }
  await save(result, output)
  await remove_vhs_task(output)
}

function parse_duration(value: string) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new InvalidArgumentError("must be an integer")
  if (n < 4 || n > 15) throw new InvalidArgumentError("must be 4-15")
  return n
}

function collect(val: string, prev: string[] | undefined) {
  return prev ? [...prev, val] : [val]
}
