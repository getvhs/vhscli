import { Command, InvalidArgumentError } from "commander"
import { die } from "../../lib/error.js"
import { save_media } from "../../lib/media.js"
import { read_prompt } from "../../lib/prompt.js"
import * as schema from "../../lib/schema/seedream.js"
import { invoke, pg_get, pg_insert, upload_image } from "../../lib/supabase.js"
import { get_session } from "../session.js"

const sizes = ["2K", "4K"] as const
const min_pixels = 3_686_400
const max_pixels = 16_777_216

export function register_seedream_4_5(program: Command) {
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

async function run(prompt_arg: string, opts: { output?: string; image?: string[]; size?: string }) {
  const prompt = await read_prompt(prompt_arg)
  const images = opts.image ?? []
  if (images.length > 14) die("-i accepts at most 14 images")

  const sess = await get_session()
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

  const task_id = crypto.randomUUID()
  console.log(`task_id: ${task_id}`)
  await pg_insert(sess, "task2", {
    id: task_id,
    user_id: sess.user_id,
    endpoint: "byteplus:seedream-4-5",
    payload: schema.Request.parse(payload),
  })

  console.log("generating image...")
  const submit_res = await invoke(sess, "main2/submit", { task_id })
  if (!submit_res.ok) die(submit_res.err)

  const done = await pg_get(sess, "task2", "result, err", task_id)
  if (!done) die(`task disappeared: ${task_id}`)
  if (done.err) die(done.err)
  await save_seedream_4_5_result(done.result, opts.output ?? null)
}

export async function save_seedream_4_5_result(result: unknown, output: string | null) {
  const item = schema.Response.parse(result).data[0]!
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
