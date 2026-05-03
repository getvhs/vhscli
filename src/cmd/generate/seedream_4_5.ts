import { Command, InvalidArgumentError } from "commander"
import { die } from "../../lib/error.js"
import { save_media } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/seedream.js"
import { type Session } from "../../lib/session.js"
import { submit } from "../../lib/submit.js"
import { upload_image } from "../../lib/media.js"
import { kparse } from "../../lib/parse.js"
import { get_session } from "../session.js"

const sizes = ["2K", "4K"] as const
const min_pixels = 3_686_400
const max_pixels = 16_777_216

type Opts = { output?: string; image?: string[]; size?: string }

export function register(program: Command) {
  program.command("seedream-4-5")
    .description("generate an image with seedream 4.5")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-seedream-4-5-<timestamp>.jpg)")
    .option("-i, --image <path>", "reference image (max 14, repeat -i for more)", collect)
    .option("--size <size>", "image size: 2K, 4K, or WxH like 1024x1536 (default: 2K)", parse_size)
    .showHelpAfterError("(run 'vhscli generate seedream-4-5 --help' for usage)")
    .addHelpText("after", `
generates one image from a text prompt and saves a .jpg to the current
folder. pass reference images with -i (repeat -i for more, up to 14)
to guide style, characters, or composition. --size accepts presets
("2K", "4K") or exact dimensions like "1024x1536".

examples:
  vhscli generate seedream-4-5 "an open refrigerator with milk, eggs, leftover chicken, strawberries; warm light"
  vhscli generate seedream-4-5 "swap the dress to red, keep her pose unchanged" -i photo.jpg`)
    .action(run)
}

async function run(prompt_arg: string, opts: Opts) {
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const { result, err } = await submit(sess, "byteplus:seedream-4-5", payload, "generating image...", 300_000)
  if (err) die(err)
  await save(result, opts.output ?? null)
}

async function parse_opts(sess: Session, prompt_arg: string, opts: Opts) {
  const prompt = await read_prompt(prompt_arg)
  const images = opts.image ?? []
  if (images.length > 14) die("-i accepts at most 14 images")

  const image_urls: string[] = []
  for (const img of images) {
    console.log(`uploading ${img}...`)
    image_urls.push((await upload_image(sess, img)).url)
  }

  const payload: Record<string, unknown> = {
    model: "seedream-4-5-251128",
    prompt,
    response_format: "url",
    watermark: false,
  }
  if (image_urls.length === 1) payload.image = image_urls[0]
  else if (image_urls.length > 1) payload.image = image_urls
  if (opts.size) payload.size = opts.size

  return kparse(schema.request, payload, "bad seedream-4-5 payload")
}

export async function save(result: unknown, output: string | null) {
  const item = kparse(schema.response, result, "bad seedream-4-5 response").data[0]!
  if (item.error) die(`provider error: ${item.error.message}`)
  if (!item.url) die("no image url")
  await save_media(item.url, output, "seedream-4-5")
}

function parse_size(size: string) {
  if ((sizes as readonly string[]).includes(size)) return size
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) throw new InvalidArgumentError("use 2K, 4K, or WxH")

  const w = Number(match[1])
  const h = Number(match[2])
  const total = w * h
  if (total < min_pixels || total > max_pixels) throw new InvalidArgumentError("pixels out of range")
  if (w / h < 1 / 16 || w / h > 16) throw new InvalidArgumentError("bad aspect ratio")
  return size
}

function collect(val: string, prev: string[] | undefined) {
  return prev ? [...prev, val] : [val]
}
