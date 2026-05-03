import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { die } from "./error.js"
import { kfetch } from "./http.js"
import { detect_mime } from "./media.js"
import { auth_headers, supabase_url, type Session } from "./session.js"

export async function upload_file(sess: Session, path: string, content_type?: string) {
  const data = await readFile(path)
  const hash = createHash("sha256").update(data).digest("hex")
  const remote_path = `${sess.user_id}/${hash}`
  const type = content_type ?? await detect_mime(path)

  const res = await kfetch(`${supabase_url}/storage/v1/object/tmp/${remote_path}`, {
    method: "POST",
    headers: { ...auth_headers(sess), "content-type": type },
    body: data,
    timeout_ms: 600_000,
  })

  if (!res.ok) {
    const body = await res.text()
    let json: unknown
    try { json = JSON.parse(body) } catch { /* not json; keep raw text */ }
    const inner_409 = is_record(json) && json.statusCode === "409"
    if (res.status !== 409 && !inner_409) die(`upload failed: ${res.status} ${body}`)
  }

  return `${supabase_url}/storage/v1/object/public/tmp/${remote_path}`
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
