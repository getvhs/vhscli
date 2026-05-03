import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { z } from "zod"
import * as backend from "../lib/backend.js"
import { die } from "../lib/error.js"
import { creds, jwt_payload, save_creds, supabase_url, type Session } from "../lib/session.js"
import { open_browser } from "../lib/process.js"
import { kparse } from "../lib/parse.js"

type Creds = z.infer<typeof creds>

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

  server.on("request", (req, res) => { void handle_request(req, res, resolve_creds) })
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

  await save_creds(result.access_token, result.refresh_token)

  const payload = jwt_payload(result.access_token)
  const sess: Session = { access_token: result.access_token, user_id: payload.sub, email: payload.email }
  await backend.bootstrap(sess)

  console.log("authenticated")
}

async function handle_request(
  req: IncomingMessage,
  res: ServerResponse,
  resolve: (c: Creds) => void,
) {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (url.pathname === "/callback") return await send(res, 200, callback_html, "text/html")
  if (url.pathname !== "/token" || req.method !== "POST") return await send(res, 404, "not found")

  let raw: unknown
  try {
    raw = JSON.parse(await read_body(req))
  } catch {
    await send(res, 400, "bad token")
    die("bad token: invalid json")
  }

  const data = kparse(creds, raw, "bad token")
  await send(res, 200, "ok")
  resolve(data)
}

function send(res: ServerResponse, status: number, body: string, type = "text/plain") {
  return new Promise<void>((resolve) => {
    res.writeHead(status, { "content-type": type })
    res.end(body, () => resolve())
  })
}

async function read_body(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString("utf8")
}
