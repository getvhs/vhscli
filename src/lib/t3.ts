import { z } from "zod"
import * as backend from "./backend.js"
import { get_task } from "./db.js"
import { die } from "./error.js"
import * as schema from "./schema/seedance_2.js"
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

// rewrite each image_url/video_url in a seedance-2 payload to point at a
// t3 virtual-portrait asset (asset://…). text and audio entries pass
// through. used as the privacy-error fallback: t3 passthrough sends image
// urls straight to byteplus, which trips the real-face filter; reuploading
// as t3 assets routes through the byteplus virtual-portrait path that
// accepts real faces.
export async function images_to_assets(
  sess: Session,
  payload: z.infer<typeof schema.request>,
): Promise<Record<string, unknown>> {
  const new_content: Record<string, unknown>[] = []
  for (const c of payload.content) {
    if (c.type === "image_url") {
      console.log(`creating t3 asset from ${c.image_url.url}...`)
      const { asset_id } = await backend.new_asset(sess, c.image_url.url)
      new_content.push({ ...c, image_url: { url: `asset://${asset_id}` } })
    } else if (c.type === "video_url") {
      console.log(`creating t3 asset from ${c.video_url.url}...`)
      const { asset_id } = await backend.new_asset(sess, c.video_url.url)
      new_content.push({ ...c, video_url: { url: `asset://${asset_id}` } })
    } else {
      new_content.push(c)
    }
  }
  return { ...payload, content: new_content }
}
