import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { die } from "./error.js"
import { kfetch } from "./http.js"
import { kparse } from "./parse.js"

export const supabase_url = "https://hlraysuoesqgfvowfkav.supabase.co"
export const supabase_anon_key = "sb_publishable_MhbhQH2mzTf7ZhULB3zvqg_4XqUibrt"

const vhs_dir = join(homedir(), ".vhs")
export const session_path = join(vhs_dir, "session.json")

export type Session = {
  user_id: string
  access_token: string
  email: string | null
}

export function auth_headers(sess: Session) {
  return {
    apikey: supabase_anon_key,
    authorization: `Bearer ${sess.access_token}`,
  }
}

export const creds = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
})

const jwt_payload_schema = z.looseObject({
  sub: z.string(),
  exp: z.number(),
  email: z.string().nullable().default(null),
})

const refresh_response_schema = z.looseObject({
  access_token: z.string(),
  refresh_token: z.string(),
})

export async function save_creds(access_token: string, refresh_token: string) {
  await mkdir(vhs_dir, { recursive: true })
  const tmp = `${session_path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify({ access_token, refresh_token }, null, 2) + "\n")
  await rename(tmp, session_path)
}

export async function delete_creds() {
  await rm(session_path, { force: true })
}

export function jwt_payload(token: string) {
  const payload = token.split(".")[1]
  if (!payload) die("bad token")

  let data: unknown
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString())
  } catch {
    die("bad token")
  }
  return kparse(jwt_payload_schema, data, "bad token")
}

export async function load_session(): Promise<Session | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(session_path, "utf8"))
  } catch (err) {
    if (is_enoent(err)) return null
    throw err
  }

  let parsed = kparse(creds, raw, "bad session")
  const now = Math.floor(Date.now() / 1000)
  if (jwt_payload(parsed.access_token).exp - now < 60) {
    const refreshed = await refresh_session(parsed.refresh_token)
    if (!refreshed) return null
    parsed = refreshed
    await save_creds(parsed.access_token, parsed.refresh_token)
  }

  const payload = jwt_payload(parsed.access_token)
  return { access_token: parsed.access_token, user_id: payload.sub, email: payload.email }
}

async function refresh_session(refresh_token: string) {
  const res = await kfetch(`${supabase_url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: supabase_anon_key, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token }),
    timeout_ms: 15_000,
  })

  if (res.status === 400 || res.status === 401) return null
  if (!res.ok) die(`refresh failed: ${res.status}`)
  return kparse(refresh_response_schema, await res.json(), "bad refresh response")
}

function is_enoent(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT"
}
