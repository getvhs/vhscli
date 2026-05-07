import { z } from "zod"
import * as backend from "./backend.js"
import { get_task } from "./db.js"
import { die } from "./error.js"
import { save_media } from "./media.js"
import * as seedance_schema from "./schema/seedance_2.js"
import * as schema from "./schema/t3_seedance_2.js"
import { type Session } from "./session.js"
import { create_and_submit } from "./task.js"
import { kparse } from "./parse.js"

// t3 has no broadcast; /poll/t3 is pull-based, so we drive it directly
// instead of using poll2. each /poll/t3 call advances the upstream poll for
// up to ~40s, finalizing task2 when the video resolves. early errors (t3
// rejected at submit) surface as completed_at + err set by /poll/t3.
export async function submit_and_poll_t3(sess: Session, payload: Record<string, unknown>): Promise<unknown> {
  const task_id = await create_and_submit(sess, "t3:seedance2", kparse(schema.request, payload, "bad t3-seedance-2 payload"))

  console.log("generating video...")
  const start = Date.now()
  while (true) {
    const poll_res = await backend.poll_t3(sess, task_id)
    if (poll_res.is_completed) break
    console.log(`polling... ${Math.round((Date.now() - start) / 1000)}s`)
  }

  const row = await get_task(sess, task_id)
  if (!row) die(`task disappeared: ${task_id}`)
  if (row.err) die(row.err)
  if (!row.result) die("task completed without result")
  return row.result
}

export async function save_t3_seedance_2_result(result: unknown, output: string | null) {
  const url = kparse(schema.response, result, "bad t3-seedance-2 response").url
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
    if (c.type === "image_url") {
      console.log(`creating t3 asset from ${c.image_url.url}...`)
      const { asset_id } = await backend.new_asset(sess, c.image_url.url)
      const url = `asset://${asset_id}`
      if (c.role === "first_frame" || c.role === "last_frame") {
        frame_images.push({ type: "image_url", frame_type: c.role, image_url: { url } })
      } else {
        input_references.push({ type: "image_url", image_url: { url } })
      }
    } else if (c.type === "video_url") {
      console.log(`creating t3 asset from ${c.video_url.url}...`)
      const { asset_id } = await backend.new_asset(sess, c.video_url.url)
      input_references.push({ type: "video_url", video_url: { url: `asset://${asset_id}` } })
    } else {
      // audio: token360 fetches the public url directly; no asset upload.
      input_references.push({ type: "audio_url", audio_url: { url: c.audio_url.url } })
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
