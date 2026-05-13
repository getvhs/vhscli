import { z } from "zod"
import * as backend from "./backend.js"
import { get_task } from "./db.js"
import { die } from "./error.js"
import * as schema from "./schema/simple.js"
import { type Session } from "./session.js"

// drives /poll/t3 (pull-based) until the task finalizes, then loads
// result/err from the task row. mirrors wait_for_task for the t3 path,
// which has no broadcast.
export async function wait_for_t3_task(
  sess: Session,
  task_id: string,
): Promise<{ result: unknown; err: string | null }> {
  const start = Date.now()
  while (true) {
    const res = await backend.poll_t3(sess, task_id)
    if (res.is_completed) break
    console.log(`polling... ${Math.round((Date.now() - start) / 1000)}s`)
  }
  const row = await get_task(sess, task_id)
  if (!row) die(`task disappeared: ${task_id}`)
  return { result: row.result, err: row.err }
}

// rewrite every image / video url in a simple seedance-2 payload to point at
// a t3 virtual-portrait asset (asset://…). used as the privacy-error
// fallback: t3 passthrough sends urls straight to byteplus, which trips the
// real-face filter for both images and videos; reuploading as t3 assets
// routes through the virtual-portrait path that accepts real faces. t3
// new_asset accepts jpeg / png / mp4 (see vhs-main t3/index.ts). audio urls
// pass through.
export async function media_to_assets(
  sess: Session,
  payload: z.infer<typeof schema.simple_video_request>,
): Promise<Record<string, unknown>> {
  const wrap = async (url: string) => {
    console.log(`creating t3 asset from ${url}...`)
    const { asset_id } = await backend.new_asset(sess, url)
    return `asset://${asset_id}`
  }
  const wrap_list = async (urls: string[]) => {
    const out: string[] = []
    for (const u of urls) out.push(await wrap(u))
    return out
  }

  const out: Record<string, unknown> = { ...payload }
  if (payload.input_image) out.input_image = await wrap_list(payload.input_image)
  if (payload.input_video) out.input_video = await wrap_list(payload.input_video)
  if (payload.first_frame) out.first_frame = await wrap(payload.first_frame)
  if (payload.last_frame) out.last_frame = await wrap(payload.last_frame)
  return out
}
