import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import { z } from "zod"
import * as backend from "./backend.js"
import { die } from "./error.js"
import { kfetch } from "./http.js"
import { kparse } from "./parse.js"
import { open_browser } from "./process.js"

export const supabase_url = "https://hlraysuoesqgfvowfkav.supabase.co"
export const supabase_anon_key = "sb_publishable_MhbhQH2mzTf7ZhULB3zvqg_4XqUibrt"

const vhs_dir = join(homedir(), ".vhs")
export const session_path = join(vhs_dir, "session.json")

// seconds of remaining lifetime below which we refresh ahead of expiry.
const REFRESH_SKEW_S = 60
const REFRESH_FETCH_MS = 15_000
const LOCK_STALE_MS = 20_000

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

type Creds = z.infer<typeof creds>

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
  clear_session_cache()
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

function token_exp(access_token: string): number | null {
  const payload = access_token.split(".")[1]
  if (!payload) return null
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString())
    const parsed = jwt_payload_schema.safeParse(data)
    if (!parsed.success) return null
    return parsed.data.exp
  } catch {
    return null
  }
}

function near_expiry(access_token: string) {
  const exp = token_exp(access_token)
  if (exp === null) return true
  return exp - Math.floor(Date.now() / 1000) < REFRESH_SKEW_S
}

async function read_creds(): Promise<Creds | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(session_path, "utf8"))
  } catch (err) {
    if (is_enoent(err)) return null
    throw err
  }
  return kparse(creds, raw, "bad session")
}

function lock_session() {
  return lockfile.lock(session_path, {
    stale: LOCK_STALE_MS,
    realpath: false,
    onCompromised: (err) => console.error("session lock compromised:", err),
    retries: {
      retries: 12,
      factor: 1.6,
      minTimeout: 100,
      maxTimeout: 3_000,
      randomize: true,
    },
  })
}

async function exchange_refresh_token(refresh_token: string): Promise<Creds | null> {
  const res = await kfetch(`${supabase_url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: supabase_anon_key, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token }),
    timeout_ms: REFRESH_FETCH_MS,
  })

  if (res.status === 400 || res.status === 401) return null
  if (!res.ok) die(`refresh failed: ${res.status}`)
  return kparse(refresh_response_schema, await res.json(), "bad refresh response")
}

// Re-reads under the lock and refreshes only if the same expiring token is
// still on disk; otherwise adopts whatever a sibling already wrote.
async function refresh_locked(seen: Creds): Promise<Creds | null> {
  let release: (() => Promise<void>) | null = null
  try {
    release = await lock_session()
  } catch (err) {
    if (is_enoent(err)) return null
    throw err
  }
  try {
    const fresh = await read_creds()
    if (!fresh) return null
    if (fresh.access_token !== seen.access_token || !near_expiry(fresh.access_token)) {
      return fresh
    }
    const next = await exchange_refresh_token(fresh.refresh_token)
    if (!next) return null
    await save_creds(next.access_token, next.refresh_token)
    return next
  } finally {
    await release().catch(() => {})
  }
}

// Collapses concurrent in-process callers onto one refresh before any of
// them reach for the file lock.
let refreshing: Promise<Creds | null> | null = null

async function get_fresh_creds(): Promise<Creds | null> {
  const current = await read_creds()
  if (!current) {
    refreshing = null
    return null
  }
  if (!near_expiry(current.access_token)) return current
  if (!refreshing) {
    refreshing = refresh_locked(current).finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

// Drop any in-flight refresh — call after login/logout so the next read
// picks up the freshly written (or now-absent) session file.
export function clear_session_cache() {
  refreshing = null
}

export async function get_session() {
  const existing = await load_session()
  if (existing) return existing

  console.log("no valid session. launching login...")
  await login()

  const session = await load_session()
  if (!session) die("login failed")
  return session
}

export async function load_session(): Promise<Session | null> {
  const parsed = await get_fresh_creds()
  if (!parsed) return null

  const payload = jwt_payload(parsed.access_token)
  return { access_token: parsed.access_token, user_id: payload.sub, email: payload.email }
}

function is_enoent(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT"
}

const callback_html = `<!DOCTYPE html><html><body><script>
const h = new URLSearchParams(location.hash.slice(1));
fetch("/token", {
  method: "POST",
  headers: {"content-type": "application/json"},
  body: JSON.stringify({
    access_token: h.get("access_token"),
    refresh_token: h.get("refresh_token"),
  })
}).then(() => { document.body.innerText = "logged in. you can close this tab."; });
</script></body></html>`

const login_timeout_ms = 5 * 60 * 1000

export async function login() {
  const server = createServer()

  let resolve_creds!: (c: Creds) => void
  let reject_creds!: (err: Error) => void
  const creds_promise = new Promise<Creds>((resolve, reject) => {
    resolve_creds = resolve
    reject_creds = reject
  })

  server.on("request", (req, res) => { void handle_login_request(req, res, resolve_creds) })
  server.on("error", reject_creds)

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  const addr = server.address()
  if (typeof addr !== "object" || !addr) die("bad auth server")

  const auth_url = `${supabase_url}/auth/v1/authorize?provider=google&redirect_to=http://localhost:${addr.port}/callback`
  console.log("opening browser for google login...")

  const timer = setTimeout(() => reject_creds(new Error("login timed out")), login_timeout_ms)

  let result: Creds
  try {
    await open_browser(auth_url)
    result = await creds_promise
  } catch (err) {
    die(err instanceof Error ? err.message : "login failed")
  } finally {
    clearTimeout(timer)
    server.close()
  }

  clear_session_cache()
  await save_creds(result.access_token, result.refresh_token)

  const payload = jwt_payload(result.access_token)
  const sess: Session = { access_token: result.access_token, user_id: payload.sub, email: payload.email }
  await backend.bootstrap(sess)

  console.log("authenticated")
}

async function handle_login_request(
  req: IncomingMessage,
  res: ServerResponse,
  resolve: (c: Creds) => void,
) {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (url.pathname === "/callback") return await send_login_response(res, 200, callback_html, "text/html")
  if (url.pathname !== "/token" || req.method !== "POST") return await send_login_response(res, 404, "not found")

  let raw: unknown
  try {
    raw = JSON.parse(await read_login_body(req))
  } catch {
    await send_login_response(res, 400, "bad token")
    die("bad token: invalid json")
  }

  const data = kparse(creds, raw, "bad token")
  await send_login_response(res, 200, "ok")
  resolve(data)
}

function send_login_response(res: ServerResponse, status: number, body: string, type = "text/plain") {
  return new Promise<void>((resolve) => {
    res.writeHead(status, { "content-type": type })
    res.end(body, () => resolve())
  })
}

async function read_login_body(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString("utf8")
}
