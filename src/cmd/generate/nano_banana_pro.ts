import { Command, Option } from "commander"
import { die } from "../../lib/error.js"
import { save_media, validate_output } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/nano_banana.js"
import { get_session, type Session } from "../../lib/session.js"
import { create_and_submit, wait_for_task } from "../../lib/task.js"
import { upload_image } from "../../lib/media.js"
import { kparse } from "../../lib/parse.js"

const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
const sizes = ["1K", "2K", "4K"]

type Opts = { output?: string; i?: string[]; ratio?: string; size?: string }

export function register(program: Command) {
  program.command("nano-banana-pro")
    .description("generate an image with nano banana pro")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-nano-banana-pro-<timestamp>.png)")
    .option("-i <path>", "reference image (max 14, repeat -i for more)", collect)
    .addOption(new Option("--ratio <ratio>", "aspect ratio (default: 1:1)").choices(ratios))
    .addOption(new Option("--size <size>", "image size (default: 1K)").choices(sizes))
    .showHelpAfterError("(run 'vhscli generate nano-banana-pro --help' for usage)")
    .addHelpText("after", `
generates one image from a text prompt and saves a .png to the current
folder. pass reference images with -i (repeat -i for more, up to 14).

examples:
  vhscli generate nano-banana-pro "a glossy face moisturizer jar on warm studio backdrop"
  vhscli generate nano-banana-pro "a sun-drenched minimalist living room with a 3d armchair from this sketch" -i sketch.jpg`)
    .action(run)
}

async function run(prompt_arg: string, opts: Opts) {
  validate_output(opts.output, "image")
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const task_id = await create_and_submit(sess, "google:nano_banana_pro", payload)
  console.log("generating image...")
  const { result, err } = await wait_for_task(sess, task_id)
  if (err) die(err)
  await save(result, opts.output ?? null)
}

async function parse_opts(sess: Session, prompt_arg: string, opts: Opts) {
  const prompt = await read_prompt(prompt_arg)
  const images = opts.i ?? []
  if (images.length > 14) die("-i accepts at most 14 images")

  const parts: Record<string, unknown>[] = [{ text: prompt }]
  for (const img of images) {
    console.log(`uploading ${img}...`)
    const { url, mime } = await upload_image(sess, img)
    parts.push({ inlineData: { mimeType: mime, url } })
  }

  const payload: Record<string, unknown> = { contents: [{ parts }] }
  const image_config: Record<string, unknown> = {
    imageSize: opts.size ?? "1K",
    aspectRatio: opts.ratio ?? "1:1",
  }
  payload.generationConfig = { imageConfig: image_config }

  return kparse(schema.request, payload, "bad nano-banana-pro payload")
}

export async function save(result: unknown, output: string | null) {
  const cand = kparse(schema.response, result, "bad nano-banana-pro response").candidates[0]!
  for (const part of cand.content.parts ?? []) {
    if (part.inlineData) {
      await save_media(part.inlineData.url, output, "nano-banana-pro")
      return
    }
  }
  die(`no image returned: ${cand.finishReason ?? "unknown"}`)
}

function collect(val: string, prev: string[] | undefined) {
  return prev ? [...prev, val] : [val]
}
