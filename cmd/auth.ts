import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { die } from "../lib/error.js"
import { CredsSchema, save_creds, supabase_url } from "../lib/session.js"
import { open_browser } from "../lib/process.js"

const callback_html = `<!DOCTYPE html><html><body><script>
const h = new URLSearchParams(location.hash.slice(1));
fetch("/token", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({
    access_token: h.get("access_token"),
    refresh_token: h.get("refresh_token"),
  })
}).then(() => { document.body.innerText = "logged in. you can close this tab."; });
</script></body></html>`

export async function auth() {
  const server = createServer()
  const token = new Promise<{ access_token: string; refresh_token: string }>((resolve, reject) => {
    server.on("request", (req, res) => { void handle_request(req, res, resolve) })
    server.on("error", reject)
  })

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  const port = server.address()
  if (typeof port !== "object" || !port) die("bad auth server")

  const auth_url = `${supabase_url}/auth/v1/authorize?provider=google&redirect_to=http://localhost:${port.port}/callback`
  console.log("opening browser for google login...")

  let creds: { access_token: string; refresh_token: string }
  try {
    await open_browser(auth_url)
    creds = await token
  } finally {
    server.close()
  }

  await save_creds(creds.access_token, creds.refresh_token)
  console.log("authenticated")
}

async function handle_request(
  req: IncomingMessage,
  res: ServerResponse,
  resolve: (creds: { access_token: string; refresh_token: string }) => void,
) {
  try {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (url.pathname === "/callback") return send(res, 200, callback_html, "text/html")
    if (url.pathname !== "/token" || req.method !== "POST") return send(res, 404, "not found")

    const parsed = CredsSchema.parse(JSON.parse(await read_body(req)))
    send(res, 200, "ok")
    resolve(parsed)
  } catch {
    send(res, 400, "bad token")
    die("bad token")
  }
}

function send(res: ServerResponse, status: number, body: string, type = "text/plain") {
  res.writeHead(status, { "content-type": type })
  res.end(body)
}

async function read_body(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString("utf8")
}
