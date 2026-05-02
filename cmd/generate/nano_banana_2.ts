import { Command, Option } from "commander"
import { die } from "../../lib/error.js"
import { save_media } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/nano_banana.js"
import { type Session } from "../../lib/session.js"
import { submit } from "../../lib/submit.js"
import { upload_image } from "../../lib/supabase.js"
import { zparse } from "../../lib/util.js"
import { get_session } from "../session.js"

const ratios = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"]
const sizes = ["512", "1K", "2K", "4K"]
const think_levels = ["minimal", "high"]

type Opts = {
  output?: string
  image?: string[]
  ratio?: string
  size?: string
  think?: string
  search?: boolean
  imageSearch?: boolean
}

export function register(program: Command) {
  program.command("nano-banana-2")
    .description("generate an image with nano banana 2")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-nano-banana-2-<timestamp>.png)")
    .option("-i, --image <path>", "reference image (max 14, repeat -i for more)", collect)
    .addOption(new Option("--ratio <ratio>", "aspect ratio (default: 1:1)").choices(ratios))
    .addOption(new Option("--size <size>", "image size (default: 1K)").choices(sizes))
    .addOption(new Option("--think <level>", "how hard the model thinks (default: minimal)").choices(think_levels))
    .option("--search", "use google search while generating")
    .option("--image-search", "also use google image search (implies --search)")
    .showHelpAfterError("(run 'vhscli generate nano-banana-2 --help' for usage)")
    .addHelpText("after", `
generates one image from a text prompt and saves a .png to the current
folder. pass reference images with -i (repeat -i for more, up to 14).
--search lets the model look up live info from google.

examples:
  vhscli generate nano-banana-2 "remove the man from the photo, keep everything else" -i photo.jpg
  vhscli generate nano-banana-2 "current weather in san francisco shown as a tiny city-in-a-cup" --search`)
    .action(run)
}

async function run(prompt_arg: string, opts: Opts) {
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const { result } = await submit(sess, "google:nano_banana_2", payload, "generating image...", 300_000)
  await save(result, opts.output ?? null)
}

async function parse_opts(sess: Session, prompt_arg: string, opts: Opts) {
  const prompt = await read_prompt(prompt_arg)
  const images = opts.image ?? []
  if (images.length > 14) die("-i accepts at most 14 images")

  const parts: Record<string, unknown>[] = [{ text: prompt }]
  for (const img of images) {
    console.log(`uploading ${img}...`)
    const { url, mime } = await upload_image(sess, img)
    parts.push({ inlineData: { mimeType: mime, url } })
  }

  const payload: Record<string, unknown> = { contents: [{ parts }] }
  const image_config: Record<string, unknown> = {}
  if (opts.ratio) image_config.aspectRatio = opts.ratio
  if (opts.size) image_config.imageSize = opts.size

  const gen_config: Record<string, unknown> = {}
  if (Object.keys(image_config).length > 0) gen_config.imageConfig = image_config
  if (opts.think) gen_config.thinkingConfig = { thinkingLevel: opts.think }
  if (Object.keys(gen_config).length > 0) payload.generationConfig = gen_config

  if (opts.search || opts.imageSearch) {
    const search_types: Record<string, object> = { webSearch: {} }
    if (opts.imageSearch) search_types.imageSearch = {}
    payload.tools = [{ googleSearch: { searchTypes: search_types } }]
  }

  return zparse(schema.request, payload, "bad nano-banana-2 payload")
}

export async function save(result: unknown, output: string | null) {
  const cand = zparse(schema.response, result, "bad nano-banana-2 response").candidates[0]!
  for (const part of cand.content.parts ?? []) {
    if (part.inlineData) {
      await save_media(part.inlineData.url, output, "nano-banana-2")
      return
    }
  }
  die(`no image returned: ${cand.finishReason ?? "unknown"}`)
}

function collect(val: string, prev: string[] | undefined) {
  return prev ? [...prev, val] : [val]
}
