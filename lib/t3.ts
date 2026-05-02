import { z } from "zod"
import { die } from "./error.js"
import { save_media } from "./media.js"
import * as seedance_schema from "./schema/seedance_2.js"
import * as schema from "./schema/t3_seedance_2.js"
import { task2 } from "./schema/task2.js"
import { type Session } from "./session.js"
import { invoke, pg_get, pg_insert } from "./supabase.js"
import { submit_response } from "./submit.js"
import { zparse } from "./util.js"

const new_asset_response = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), token360_asset_id: z.string() }),
  z.object({ ok: z.literal(false), err: z.string() }),
])

export const poll_response = z.discriminatedUnion("ok", [
  z.looseObject({ ok: z.literal(true), is_completed: z.boolean().optional() }),
  z.object({ ok: z.literal(false), err: z.string() }),
])

export async function new_asset(sess: Session, image_url: string): Promise<string> {
  const res = await invoke(sess, "t3/new_asset", { image_url }, new_asset_response, 90_000)
  if (!res.ok) die(`t3/new_asset: ${res.err}`)
  return res.token360_asset_id
}

export async function submit_and_poll_t3(sess: Session, payload: Record<string, unknown>): Promise<unknown> {
  const task_id = crypto.randomUUID()
  console.log(`task_id: ${task_id}`)
  await pg_insert(sess, "task2", {
    id: task_id,
    user_id: sess.user_id,
    endpoint: "t3:seedance2",
    payload: zparse(schema.request, payload, "bad t3-seedance-2 payload"),
  })

  process.stdout.write("generating video...")
  const submit_res = await invoke(sess, "main2/submit", { task_id }, submit_response, 90_000)
  if (!submit_res.ok) {
    process.stdout.write("\n")
    die(submit_res.err)
  }

  const intermediate = zparse(schema.intermediate, submit_res.intermediate, "bad submit response")
  if (intermediate.error) {
    process.stdout.write("\n")
    const e = intermediate.error
    die(e.code ? `${e.code}: ${e.message}` : e.message)
  }

  while (true) {
    process.stdout.write(".")
    const poll_res = await invoke(sess, "main2/poll/t3", { task_id }, poll_response, 60_000)
    if (!poll_res.ok) {
      process.stdout.write("\n")
      die(poll_res.err)
    }
    if (poll_res.is_completed) break
  }
  process.stdout.write("\n")

  const data = await pg_get(sess, "task2", "result, err", task_id)
  if (!data) die(`task disappeared: ${task_id}`)
  const row = zparse(task2, data, "bad task2 row")
  if (row.err) die(row.err)
  if (!row.result) die("task completed without result")
  return row.result
}

export async function save_t3_seedance_2_result(result: unknown, output: string | null) {
  const url = zparse(schema.response, result, "bad t3-seedance-2 response").url
  await save_media(url, output, "t3-seedance-2")
}

export async function translate_seedance_2_to_t3(sess: Session, payload: z.infer<typeof seedance_schema.request>): Promise<Record<string, unknown>> {
  if (payload.ratio === "adaptive") die("--ratio adaptive is not supported by t3-seedance-2 fallback; pick a fixed aspect ratio and retry")
  if (payload.duration === -1) die("--duration -1 (auto) is not supported by t3-seedance-2 fallback; pick a fixed duration and retry")

  const text_items = payload.content.filter((c) => c.type === "text")
  const prompt = text_items.map((c) => c.text).join("\n").trim()
  if (!prompt) die("no text prompt to translate")

  const frame_images: Record<string, unknown>[] = []
  const input_references: Record<string, unknown>[] = []

  for (const c of payload.content) {
    if (c.type === "text") continue
    if (c.type === "audio_url") die("audio references can't translate to t3-seedance-2; remove -a and retry")
    if (c.type === "image_url") {
      console.log(`creating token360 asset from ${c.image_url.url}...`)
      const asset_id = await new_asset(sess, c.image_url.url)
      const url = `asset://${asset_id}`
      if (c.role === "first_frame" || c.role === "last_frame") {
        frame_images.push({ type: "image_url", frame_type: c.role, image_url: { url } })
      } else {
        input_references.push({ type: "image_url", image_url: { url } })
      }
    } else {
      input_references.push({ type: "video_url", video_url: { url: c.video_url.url } })
    }
  }

  const out: Record<string, unknown> = { model: "seedance-2.0", prompt }
  if (frame_images.length > 0) out.frame_images = frame_images
  if (input_references.length > 0) out.input_references = input_references
  if (payload.resolution) out.resolution = payload.resolution
  if (payload.ratio) out.aspect_ratio = payload.ratio
  if (payload.duration != null) out.duration = payload.duration
  if (payload.generate_audio != null) out.generate_audio = payload.generate_audio
  if (payload.seed != null) out.seed = payload.seed
  if (payload.watermark != null) out.watermark = payload.watermark
  return out
}
