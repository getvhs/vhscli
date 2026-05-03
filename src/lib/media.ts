import { rename, unlink, writeFile } from "node:fs/promises"
import { die } from "./error.js"
import { kfetch } from "./http.js"
import { run_process } from "./process.js"

const mime_ext: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
}

export async function save_media(url: string, output: string | null, model: string) {
  const res = await kfetch(url, { timeout_ms: 600_000 })
  if (!res.ok) die(`download failed: ${res.status}`)

  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
  const src_ext = mime_ext[mime]
  if (!src_ext) die(`unknown content-type: ${mime}`)

  const final_output = output ?? default_output(model, src_ext)
  const target_ext = output_ext(final_output)
  const data = Buffer.from(await res.arrayBuffer())

  if (target_ext === src_ext) {
    const tmp = `${final_output}.tmp.${src_ext}`
    await writeFile(tmp, data)
    await rename(tmp, final_output)
    console.log(`saved to ${final_output}`)
    return
  }

  const src_tmp = `${final_output}.src.${src_ext}`
  const out_tmp = `${final_output}.tmp.${target_ext}`
  await writeFile(src_tmp, data)

  const is_video = mime.startsWith("video/")
  const cmd = is_video ? "ffmpeg" : "sips"
  const args = is_video
    ? ["-y", "-i", src_tmp, out_tmp]
    : ["-s", "format", target_ext === "jpg" ? "jpeg" : target_ext, src_tmp, "--out", out_tmp]

  const proc = await run_process(cmd, args)
  if (proc.code !== 0) die(`${cmd} conversion failed: ${proc.code}`)

  await unlink(src_tmp)
  await rename(out_tmp, final_output)
  console.log(`saved to ${final_output}`)
}

function default_output(model: string, ext: string) {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `vhscli-${model}-${ts}.${ext}`
}

function output_ext(path: string) {
  const dot = path.lastIndexOf(".")
  if (dot < 0) die(`no extension: ${path}`)
  const ext = path.slice(dot + 1).toLowerCase()
  return ext === "jpeg" ? "jpg" : ext
}
