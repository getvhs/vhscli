import { Command, InvalidArgumentError } from "commander"
import { die } from "../../lib/error.js"
import { default_output, save_media, validate_output } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/simple.js"
import { get_session, type Session } from "../../lib/session.js"
import { create_and_submit, type Mode, wait_for_task } from "../../lib/task.js"
import { upload_image } from "../../lib/media.js"
import { kparse } from "../../lib/parse.js"
import { remove_vhs_task, write_vhs_task } from "../../lib/vhs_task.js"

const sizes = ["2K", "4K"] as const
const min_pixels = 3_686_400
const max_pixels = 16_777_216

type Opts = { output?: string; i?: string[]; size?: string }

export function register(parent: Command, mode: Mode) {
  parent.command("seedream-4-5")
    .description(mode === "submit" ? "submit a seedream 4.5 image task" : "generate an image with seedream 4.5")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-seedream-4-5-<timestamp>.jpg)")
    .option("-i <path>", "reference image (max 14, repeat -i for more)", collect)
    .option("--size <size>", "image size: 2K, 4K, or WxH like 1024x1536 (default: 2K)", parse_size)
    .showHelpAfterError(`(run 'vhscli ${mode} seedream-4-5 --help' for usage)`)
    .addHelpText("after", `
generates one image from a text prompt and saves a .jpg to the current
folder. pass reference images with -i (repeat -i for more, up to 14)
to guide style, characters, or composition. --size accepts presets
("2K", "4K") or exact dimensions like "1024x1536".

examples:
  vhscli ${mode} seedream-4-5 "an open refrigerator with milk, eggs, leftover chicken, strawberries; warm light"
  vhscli ${mode} seedream-4-5 "swap the dress to red, keep her pose unchanged" -i photo.jpg`)
    .action((prompt_arg, opts) => run(prompt_arg, opts, mode))
}

async function run(prompt_arg: string, opts: Opts, mode: Mode) {
  validate_output(opts.output, "image")
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const output = opts.output ?? default_output("seedream-4-5", "jpg")
  const task_id = await create_and_submit(sess, "a1:byteplus:seedream-4-5", payload)
  await write_vhs_task(output, task_id)
  if (mode === "submit") return
  console.log("generating image...")
  const { result, err } = await wait_for_task(sess, task_id)
  if (err) {
    await remove_vhs_task(output)
    die(err)
  }
  await save(result, output)
  await remove_vhs_task(output)
}

async function parse_opts(sess: Session, prompt_arg: string, opts: Opts) {
  const prompt = await read_prompt(prompt_arg)
  const images = opts.i ?? []
  if (images.length > 14) die("-i accepts at most 14 images")

  const input_image: string[] = []
  for (const img of images) {
    console.log(`uploading ${img}...`)
    input_image.push((await upload_image(sess, img)).url)
  }

  const payload: Record<string, unknown> = {
    prompt,
    size: opts.size ?? "2K",
  }
  if (input_image.length > 0) payload.input_image = input_image

  return kparse(schema.simple_image_request, payload, "bad seedream-4-5 payload")
}

export async function save(result: unknown, output: string | null) {
  const r = kparse(schema.simple_image_response, result, "bad seedream-4-5 response")
  await save_media(r.image_url, output, "seedream-4-5")
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
