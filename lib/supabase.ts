import { createHash } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { z } from "zod"
import { fileTypeFromFile } from "file-type"
import { die } from "./error.js"
import { kfetch, zparse } from "./util.js"
import { run_process } from "./process.js"
import { supabase_anon_key, supabase_url, type Session } from "./session.js"

function auth_headers(sess: Session) {
  return {
    apikey: supabase_anon_key,
    authorization: `Bearer ${sess.access_token}`,
  }
}

export async function invoke<T extends z.ZodType>(
  sess: Session,
  fn: string,
  body: Record<string, unknown>,
  schema: T,
  timeout_ms: number,
): Promise<z.infer<T>> {
  const res = await kfetch(`${supabase_url}/functions/v1/${fn}`, {
    method: "POST",
    headers: { ...auth_headers(sess), "content-type": "application/json" },
    body: JSON.stringify(body),
    timeout_ms,
  })

  if (!res.ok) die(`edge function error: ${res.status} ${await res.text()}`)
  return zparse(schema, await res.json(), `bad ${fn} response`)
}

export async function pg_insert(sess: Session, table: string, row: Record<string, unknown>) {
  const res = await kfetch(`${supabase_url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...auth_headers(sess), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(row),
    timeout_ms: 15_000,
  })

  if (!res.ok) die(`insert failed: ${res.status} ${await res.text()}`)
}

export async function pg_get(sess: Session, table: string, select: string, id: string): Promise<Record<string, unknown> | null> {
  const url = new URL(`${supabase_url}/rest/v1/${table}`)
  url.searchParams.set("select", select)
  url.searchParams.set("id", `eq.${id}`)
  url.searchParams.set("limit", "1")

  const res = await kfetch(url, { headers: auth_headers(sess), timeout_ms: 15_000 })
  if (!res.ok) die(`query failed: ${res.status} ${await res.text()}`)

  const rows = await res.json()
  if (!Array.isArray(rows)) die("bad pg response")
  const row = rows[0]
  if (row == null) return null
  if (typeof row !== "object") die("bad pg response")
  return row as Record<string, unknown>
}

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

export async function upload_image(sess: Session, path: string) {
  const mime = await detect_mime(path)
  if (mime === "image/jpeg" || mime === "image/png") {
    return { url: await upload_file(sess, path, mime), mime }
  }

  const tmp = join(tmpdir(), `vhscli-${process.pid}-${Date.now()}-${basename(path)}.jpg`)
  const res = await run_process("sips", ["-s", "format", "jpeg", path, "--out", tmp])
  if (res.code !== 0) die(`sips conversion failed: ${res.code}`)

  try {
    return { url: await upload_file(sess, tmp, "image/jpeg"), mime: "image/jpeg" }
  } finally {
    await rm(tmp, { force: true })
  }
}

async function detect_mime(path: string) {
  const result = await fileTypeFromFile(path)
  if (!result) die(`file mime detection failed: ${path}`)
  return result.mime
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
