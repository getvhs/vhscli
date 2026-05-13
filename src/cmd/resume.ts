import { Command } from "commander"
import { get_task } from "../lib/db.js"
import { die } from "../lib/error.js"
import { validate_output } from "../lib/media.js"
import { get_session, type Session } from "../lib/session.js"
import * as gpt_image_2 from "./generate/gpt_image_2.js"
import * as nano_banana_2 from "./generate/nano_banana_2.js"
import * as nano_banana_pro from "./generate/nano_banana_pro.js"
import * as seedance_2 from "./generate/seedance_2.js"
import * as seedream_4_5 from "./generate/seedream_4_5.js"
import * as seedream_5 from "./generate/seedream_5.js"
import { wait_for_t3_task } from "../lib/t3.js"
import { wait_for_task } from "../lib/task.js"
import { read_vhs_task, remove_vhs_task } from "../lib/vhs_task.js"

export function register_resume(program: Command) {
  program.command("resume")
    .description("finish aborted generations from their .vhs_task sidecar files")
    .argument("<files...>", ".vhs_task files (e.g. clip.mp4.vhs_task)")
    .showHelpAfterError("(run 'vhscli resume --help' for usage)")
    .addHelpText("after", `
each generate or submit writes a <output>.vhs_task sidecar next to the
intended output. resume waits for the task to finish, saves the media
to <output>, and removes the sidecar.

examples:
  vhscli resume clip.mp4.vhs_task
  vhscli resume a.jpg.vhs_task b.jpg.vhs_task`)
    .action(run)
}

async function run(files: string[]) {
  const sess = await get_session()
  for (const file of files) await resume_one(sess, file)
}

async function resume_one(sess: Session, file: string) {
  const { id: task_id, output } = await read_vhs_task(file)
  const row = await get_task(sess, task_id)
  if (!row) die(`task not found: ${task_id}`)
  if (!row.endpoint) die("task has no endpoint")
  validate_output(output, endpoint_kind(row.endpoint))

  // already finalized (e.g. resume run twice): skip the wait.
  let result = row.result as unknown
  let err = row.err

  if (!result && !err) {
    const r = row.endpoint === "a1:t3:seedance2"
      ? await wait_for_t3_task(sess, task_id)
      : await wait_for_task(sess, task_id)
    result = r.result
    err = r.err
  }

  if (err) {
    await remove_vhs_task(output)
    die(err)
  }
  if (!result) die("task completed without result")
  await save_result(row.endpoint, result, output)
  await remove_vhs_task(output)
}

async function save_result(endpoint: string, result: unknown, output: string) {
  switch (endpoint) {
    case "a1:t3:seedance2": return seedance_2.save(result, output)
    case "a1:byteplus:seedream-4-5": return seedream_4_5.save(result, output)
    case "a1:byteplus:seedream-5-0": return seedream_5.save(result, output)
    case "a1:google:nano_banana_2": return nano_banana_2.save(result, output)
    case "a1:google:nano_banana_pro": return nano_banana_pro.save(result, output)
    case "a1:openai:gpt_image_2": return gpt_image_2.save(result, output)
    default: die(`unsupported endpoint: ${endpoint}`)
  }
}

function endpoint_kind(endpoint: string): "image" | "video" {
  switch (endpoint) {
    case "a1:t3:seedance2": return "video"
    case "a1:byteplus:seedream-4-5":
    case "a1:byteplus:seedream-5-0":
    case "a1:google:nano_banana_2":
    case "a1:google:nano_banana_pro":
    case "a1:openai:gpt_image_2": return "image"
    default: die(`unsupported endpoint: ${endpoint}`)
  }
}
