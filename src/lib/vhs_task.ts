import { readFile, unlink, writeFile } from "node:fs/promises"
import { z } from "zod"
import { die } from "./error.js"
import { kparse } from "./parse.js"

// sidecar file that pairs an output path with a running task. lets the user
// abort `vhscli generate` mid-flight and finish later via `vhscli resume
// <output>.vhs_task`.
const suffix = ".vhs_task"

const vhs_task_file = z.object({ id: z.string() })

function vhs_task_path(output: string) {
  return output + suffix
}

function output_from_vhs_task_path(path: string) {
  if (!path.endsWith(suffix)) die(`not a .vhs_task file: ${path}`)
  return path.slice(0, -suffix.length)
}

export async function write_vhs_task(output: string, task_id: string) {
  const path = vhs_task_path(output)
  await writeFile(path, JSON.stringify({ id: task_id }))
  console.log(`wrote ${path}`)
}

export async function read_vhs_task(path: string) {
  const output = output_from_vhs_task_path(path)
  const text = await readFile(path, "utf8")
  const { id } = kparse(vhs_task_file, JSON.parse(text), `bad ${path}`)
  return { id, output }
}

export async function remove_vhs_task(output: string) {
  await unlink(vhs_task_path(output))
}
