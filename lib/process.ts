import { spawn } from "node:child_process"
import { die } from "./error.js"

type RunOpts = {
  stdout?: "ignore" | "pipe"
  stderr?: "ignore" | "inherit" | "pipe"
}

export async function run_process(cmd: string, args: string[], opts: RunOpts = {}) {
  const child = spawn(cmd, args, {
    stdio: ["ignore", opts.stdout ?? "ignore", opts.stderr ?? "inherit"],
  })

  let stdout = ""
  if (child.stdout) {
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { stdout += chunk })
  }

  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", resolve)
  }).catch((err) => {
    if (is_enoent(err)) die(`${cmd} not found`)
    throw err
  })

  return { code, stdout }
}

export async function open_browser(url: string) {
  const platform = process.platform
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open"
  const args = platform === "win32" ? ["/c", "start", "", url] : [url]

  const child = spawn(cmd, args, { detached: true, stdio: "ignore" })
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject)
    child.on("spawn", resolve)
  }).catch((err) => {
    if (is_enoent(err)) die(`${cmd} not found`)
    throw err
  })
  child.unref()
}

function is_enoent(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT"
}
