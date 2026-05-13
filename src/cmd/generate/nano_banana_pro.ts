import { Command, Option } from "commander"
import { die } from "../../lib/error.js"
import { default_output, save_media, validate_output } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/simple.js"
import { get_session, type Session } from "../../lib/session.js"
import { create_and_submit, type Mode, wait_for_task } from "../../lib/task.js"
import { upload_image } from "../../lib/media.js"
import { kparse } from "../../lib/parse.js"
import { remove_vhs_task, write_vhs_task } from "../../lib/vhs_task.js"

const sizes = ["1K", "2K", "4K"]

type Opts = { output?: string; i?: string[]; size?: string }

export function register(parent: Command, mode: Mode) {
  parent.command("nano-banana-pro")
    .description(mode === "submit" ? "submit a nano banana pro image task" : "generate an image with nano banana pro")
    .argument("<prompt>", "what to generate (use - to read from stdin)")
    .option("-o, --output <path>", "output file path (default: ./vhscli-nano-banana-pro-<timestamp>.png)")
    .option("-i <path>", "reference image (max 14, repeat -i for more)", collect)
    .addOption(new Option("--size <size>", "image size (default: 1K)").choices(sizes))
    .showHelpAfterError(`(run 'vhscli ${mode} nano-banana-pro --help' for usage)`)
    .addHelpText("after", `
generates one image from a text prompt and saves a .png to the current
folder. pass reference images with -i (repeat -i for more, up to 14).
output aspect ratio is fixed to 1:1.

examples:
  vhscli ${mode} nano-banana-pro "a glossy face moisturizer jar on warm studio backdrop"
  vhscli ${mode} nano-banana-pro "a sun-drenched minimalist living room with a 3d armchair from this sketch" -i sketch.jpg`)
    .action((prompt_arg, opts) => run(prompt_arg, opts, mode))
}

async function run(prompt_arg: string, opts: Opts, mode: Mode) {
  validate_output(opts.output, "image")
  const sess = await get_session()
  const payload = await parse_opts(sess, prompt_arg, opts)
  const output = opts.output ?? default_output("nano-banana-pro", "png")
  const task_id = await create_and_submit(sess, "a1:google:nano_banana_pro", payload)
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
    size: opts.size ?? "1K",
  }
  if (input_image.length > 0) payload.input_image = input_image

  return kparse(schema.simple_image_request, payload, "bad nano-banana-pro payload")
}

export async function save(result: unknown, output: string | null) {
  const r = kparse(schema.simple_image_response, result, "bad nano-banana-pro response")
  await save_media(r.image_url, output, "nano-banana-pro")
}

function collect(val: string, prev: string[] | undefined) {
  return prev ? [...prev, val] : [val]
}
