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

const size_presets = ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160"]
const min_pixels = 655_360
const max_pixels = 8_294_400
const max_edge = 3840

type Opts = { output?: string; i?: string[]; size?: string }

export function register(parent: Command, mode: Mode) {
  parent.command("gpt-image-2")
    .description(mode === "submit" ? "submit an openai gpt-image-2 task" : "generate or edit an image with openai gpt-image-2")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-gpt-image-2-<timestamp>.png)")
    .option("-i <path>", "reference image for edits (repeat -i for more)", collect)
    .option("--size <size>", "image size: preset or WxH (default: 1024x1024)", parse_size)
    .showHelpAfterError(`(run 'vhscli ${mode} gpt-image-2 --help' for usage)`)
    .addHelpText("after", `
generates one image from a text prompt and saves it to the current
folder. pass reference images with -i to edit or compose from them.

examples:
  vhscli ${mode} gpt-image-2 "a children's book drawing of a veterinarian examining a cat"
  vhscli ${mode} gpt-image-2 "replace the background with a starry night" -i photo.jpg`)
    .action((prompt_arg, opts) => run(prompt_arg, opts, mode))
}

async function run(prompt_arg: string, opts: Opts, mode: Mode) {
  validate_output(opts.output, "image")
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const output = opts.output ?? default_output("gpt-image-2", "png")
  const task_id = await create_and_submit(sess, "a1:openai:gpt_image_2", payload)
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

  const input_image: string[] = []
  for (const img of images) {
    console.log(`uploading ${img}...`)
    input_image.push((await upload_image(sess, img)).url)
  }

  const payload: Record<string, unknown> = {
    prompt,
    size: opts.size ?? "1024x1024",
  }
  if (input_image.length > 0) payload.input_image = input_image

  return kparse(schema.simple_image_request, payload, "bad gpt-image-2 payload")
}

export async function save(result: unknown, output: string | null) {
  const r = kparse(schema.simple_image_response, result, "bad gpt-image-2 response")
  await save_media(r.image_url, output, "gpt-image-2")
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
