import { Command, InvalidArgumentError } from "commander"
import { die } from "../lib/error.js"
import { read_prompt } from "../lib/prompt.js"
import * as schema from "../lib/schema/seed_lite.js"
import { upload_image } from "../lib/media.js"
import { get_session, type Session } from "../lib/session.js"
import { upload_file } from "../lib/storage.js"
import { kparse } from "../lib/parse.js"
import { create_and_submit, wait_for_task } from "../lib/task.js"

type Opts = { i?: string[]; f?: string[]; v?: string; fps?: number }

export function register_chat(program: Command) {
  program.command("chat")
    .description("chat with ai (seed 2.0; text, image, video, or pdf input)")
    .argument("<prompt>", "your message (use - to read from stdin)")
    .option("-i <path>", "image to ask about (repeat -i for more)", collect)
    .option("-f <path>", "pdf document to ask about (repeat -f for more)", collect)
    .option("-v <path>", "video to ask about")
    .option("--fps <n>", "frames per second sampled from the video: 0.2-5 (default: 1)", parse_fps)
    .showHelpAfterError("(run 'vhscli chat --help' for usage)")
    .addHelpText("after", `
prints the model's reply to your terminal. nothing is saved to disk.
attach images with -i, pdfs with -f, or one video with -v.

examples:
  vhscli chat "explain how to make sourdough in 5 steps"
  vhscli chat "summarize this paper in 5 bullets; include a page number per bullet." -f paper.pdf`)
    .action(run)
}

async function run(prompt_arg: string, opts: Opts) {
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)

  const task_id = await create_and_submit(sess, "byteplus:seed-2-0-lite", payload)
  console.log("thinking...")
  const { result, err } = await wait_for_task(sess, task_id)
  if (err) die(err)

  const parsed = kparse(schema.response, result, "bad chat response")
  const message = parsed.output.find((o): o is schema.Message => o.type === "message")
  if (!message) die("no message in chat response")
  console.log(message.content[0]!.text)
}

async function parse_opts(sess: Session, prompt_arg: string, opts: Opts) {
  const prompt = await read_prompt(prompt_arg)

  const image_urls: string[] = []
  for (const img of opts.i ?? []) {
    console.log(`uploading ${img}...`)
    image_urls.push((await upload_image(sess, img)).url)
  }

  const file_urls: string[] = []
  for (const file of opts.f ?? []) {
    console.log(`uploading ${file}...`)
    file_urls.push(await upload_file(sess, file))
  }

  let video_url: string | null = null
  if (opts.v) {
    console.log(`uploading ${opts.v}...`)
    video_url = await upload_file(sess, opts.v)
  }

  const content: Record<string, unknown>[] = []
  for (const url of file_urls) content.push({ type: "input_file", file_url: url })
  for (const url of image_urls) content.push({ type: "input_image", image_url: url })
  if (video_url) content.push({ type: "input_video", video_url, fps: opts.fps ?? 1 })
  content.push({ type: "input_text", text: prompt })

  return kparse(schema.request, {
    model: "seed-2-0-lite-260228",
    input: [{ role: "user", content }],
    stream: false,
  }, "bad chat payload")
}

function parse_fps(value: string) {
  const n = Number(value)
  if (Number.isNaN(n) || n < 0.2 || n > 5) throw new InvalidArgumentError("must be 0.2-5")
  return n
}

function collect(val: string, prev: string[] | undefined) {
  return prev ? [...prev, val] : [val]
}
