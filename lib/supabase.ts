import { createHash } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { die } from "./error.js"
import { fetch_with_timeout } from "./http.js"
import { run_process } from "./process.js"
import { supabase_anon_key, supabase_url, type Session } from "./session.js"

function auth_headers(sess: Session) {
  return {
    apikey: supabase_anon_key,
    Authorization: `Bearer ${sess.access_token}`,
  }
}

export async function invoke(sess: Session, fn: string, body: Record<string, unknown>, timeout_ms: number): Promise<any> {
  const res = await fetch_with_timeout(`${supabase_url}/functions/v1/${fn}`, {
    method: "POST",
    headers: { ...auth_headers(sess), "content-type": "application/json" },
    body: JSON.stringify(body),
    timeout_ms,
  })

  if (!res.ok) die(`edge function error: ${res.status} ${await res.text()}`)
  return await res.json()
}

export async function pg_insert(sess: Session, table: string, row: Record<string, unknown>) {
  const res = await fetch_with_timeout(`${supabase_url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...auth_headers(sess), "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
    timeout_ms: 15_000,
  })

  if (!res.ok) die(`insert failed: ${res.status} ${await res.text()}`)
}

export async function pg_get(sess: Session, table: string, select: string, id: string): Promise<any> {
  const url = new URL(`${supabase_url}/rest/v1/${table}`)
  url.searchParams.set("select", select)
  url.searchParams.set("id", `eq.${id}`)
  url.searchParams.set("limit", "1")

  const res = await fetch_with_timeout(url, { headers: auth_headers(sess), timeout_ms: 15_000 })
  if (!res.ok) die(`query failed: ${res.status} ${await res.text()}`)

  const rows = await res.json()
  if (!Array.isArray(rows)) die("bad pg response")
  return rows[0] ?? null
}

export async function upload_file(sess: Session, path: string, content_type?: string) {
  const data = await readFile(path)
  const hash = createHash("sha256").update(data).digest("hex")
  const remote_path = `${sess.user_id}/${hash}`
  const type = content_type ?? await detect_mime(path)

  const res = await fetch_with_timeout(`${supabase_url}/storage/v1/object/tmp/${remote_path}`, {
    method: "POST",
    headers: { ...auth_headers(sess), "content-type": type },
    body: data,
    timeout_ms: 600_000,
  })

  if (!res.ok) {
    const body = await parse_body(res)
    const duplicate = res.status === 409 || (is_record(body) && body.statusCode === "409")
    if (!duplicate) die(`upload failed: ${res.status} ${format_body(body)}`)
  }

  return `${supabase_url}/storage/v1/object/public/tmp/${remote_path}`
}

export async function upload_image(sess: Session, path: string) {
  const mime = await detect_mime(path)
  if (mime === "image/jpeg" || mime === "image/png") {
    return { url: await upload_file(sess, path, mime), mime }
  }

  const tmp = `${path}.vhscli-${Date.now()}.jpg`
  const res = await run_process("sips", ["-s", "format", "jpeg", path, "--out", tmp])
  if (res.code !== 0) die(`sips conversion failed: ${res.code}`)

  try {
    return { url: await upload_file(sess, tmp, "image/jpeg"), mime: "image/jpeg" }
  } finally {
    await rm(tmp, { force: true })
  }
}

async function detect_mime(path: string) {
  const res = await run_process("file", ["--mime-type", "-b", path], { stdout: "pipe" })
  const mime = res.stdout.trim()
  if (res.code !== 0 || !mime) die(`file mime detection failed: ${path}`)
  return mime
}

async function parse_body(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) as unknown } catch { return text }
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function format_body(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value)
}
