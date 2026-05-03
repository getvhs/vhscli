import { Command, InvalidArgumentError } from "commander"
import { die } from "../../lib/error.js"
import { save_media } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/gpt_image_2.js"
import { get_session, type Session } from "../../lib/session.js"
import { create_and_submit } from "../../lib/task.js"
import { upload_image } from "../../lib/media.js"
import { kparse } from "../../lib/parse.js"

const size_presets = ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160"]
const ext_format: Record<string, "png" | "jpeg" | "webp"> = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp" }
const min_pixels = 655_360
const max_pixels = 8_294_400
const max_edge = 3840

type Opts = { output?: string; image?: string[]; mask?: string; size?: string }

export function register(program: Command) {
  program.command("gpt-image-2")
    .description("generate or edit an image with openai gpt-image-2")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-gpt-image-2-<timestamp>.png)")
    .option("-i, --image <path>", "reference image for edits (repeat -i for more)", collect)
    .option("--mask <path>", "edit mask (png with transparent pixels marking edit regions); requires -i")
    .option("--size <size>", "image size: preset or WxH (default: auto)", parse_size)
    .showHelpAfterError("(run 'vhscli generate gpt-image-2 --help' for usage)")
    .addHelpText("after", `
generates one image from a text prompt and saves it to the current
folder. pass reference images with -i to edit or compose from them.
--mask takes a png where transparent pixels mark the area to edit.

examples:
  vhscli generate gpt-image-2 "a children's book drawing of a veterinarian examining a cat"
  vhscli generate gpt-image-2 "replace the background with a starry night" -i photo.jpg`)
    .action(run)
}

async function run(prompt_arg: string, opts: Opts) {
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const endpoint = payload.images?.length ? "openai:image_edits" : "openai:image_generations"
  const sub = await create_and_submit(sess, endpoint, payload, "generating image...", 300_000)
  if (!sub.ok) die(sub.err)
  await save(sub.result, opts.output ?? null)
}

async function parse_opts(sess: Session, prompt_arg: string, opts: Opts) {
  const prompt = await read_prompt(prompt_arg)
  const images = opts.image ?? []
  if (opts.mask && images.length === 0) die("--mask requires -i")

  const image_urls: string[] = []
  for (const img of images) {
    console.log(`uploading ${img}...`)
    image_urls.push((await upload_image(sess, img)).url)
  }

  let mask_url: string | undefined
  if (opts.mask) {
    console.log(`uploading ${opts.mask}...`)
    mask_url = (await upload_image(sess, opts.mask)).url
  }

  const payload: Record<string, unknown> = {
    model: "gpt-image-2",
    prompt,
    moderation: "low",
    output_format: pick_output_format(opts.output),
  }
  if (opts.size) payload.size = opts.size
  if (image_urls.length > 0) payload.images = image_urls.map((url) => ({ image_url: url }))
  if (mask_url) payload.mask = { image_url: mask_url }

  return kparse(schema.request, payload, "bad gpt-image-2 payload")
}

export async function save(result: unknown, output: string | null) {
  const item = kparse(schema.response, result, "bad gpt-image-2 response").data[0]!
  await save_media(item.url, output, "gpt-image-2")
}

function pick_output_format(output?: string) {
  if (!output) return "png" as const
  const dot = output.lastIndexOf(".")
  if (dot < 0) die(`no extension: ${output}`)

  const ext = output.slice(dot + 1).toLowerCase()
  const format = ext_format[ext]
  if (!format) die(`unsupported output ext: ${ext}`)
  return format
}

function parse_size(size: string) {
  if (size_presets.includes(size)) return size
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) throw new InvalidArgumentError("use a preset or WxH")

  const w = Number(match[1])
  const h = Number(match[2])
  const total = w * h
  if (w % 16 !== 0 || h % 16 !== 0) throw new InvalidArgumentError("sides must be multiples of 16")
  if (Math.max(w, h) > max_edge) throw new InvalidArgumentError("edge too large")
  if (total < min_pixels || total > max_pixels) throw new InvalidArgumentError("pixels out of range")
  if (Math.max(w / h, h / w) > 3) throw new InvalidArgumentError("bad aspect ratio")
  return size
}

function collect(val: string, prev: string[] | undefined) {
  return prev ? [...prev, val] : [val]
}
