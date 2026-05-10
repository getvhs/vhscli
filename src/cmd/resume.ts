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

export function register_resume(program: Command) {
  program.command("resume")
    .description("finish a generation that was aborted, by task id")
    .argument("<task_id>", "task id printed by 'vhscli generate'")
    .option("-o, --output <path>", "output file path (default: ./vhscli-<model>-<timestamp>.<ext>)")
    .showHelpAfterError("(run 'vhscli resume --help' for usage)")
    .addHelpText("after", `
some jobs take minutes. if you stop the command, paste the printed task
id into 'vhscli resume <task_id>' to wait for it and download the result.

examples:
  vhscli resume 8f3a1b2c-9e0f-4a1b-9c8d-1e2f3a4b5c6d
  vhscli resume 8f3a1b2c-9e0f-4a1b-9c8d-1e2f3a4b5c6d -o out.mp4`)
    .action(run)
}

async function run(task_id: string, opts: { output?: string }) {
  const sess = await get_session()
  const row = await get_task(sess, task_id)
  if (!row) die(`task not found: ${task_id}`)
  if (!row.endpoint) die("task has no endpoint")
  validate_output(opts.output, endpoint_kind(row.endpoint))

  // already finalized (e.g. resume run twice): skip the wait.
  let result = row.result as unknown
  let err = row.err

  if (!result && !err) {
    const r = row.endpoint === "t3:seedance2"
      ? await wait_for_t3_task(sess, task_id)
      : await wait_for_task(sess, task_id)
    result = r.result
    err = r.err
  }

  if (err) die(err)
  if (!result) die("task completed without result")
  await save_result(row.endpoint, result, opts.output ?? null)
}

async function save_result(endpoint: string, result: unknown, output: string | null) {
  switch (endpoint) {
    case "t3:seedance2": return seedance_2.save(result, output)
    case "byteplus:seedream-4-5": return seedream_4_5.save(result, output)
    case "byteplus:seedream-5-0": return seedream_5.save(result, output)
    case "google:nano_banana_2": return nano_banana_2.save(result, output)
    case "google:nano_banana_pro": return nano_banana_pro.save(result, output)
    case "openai:image_generations":
    case "openai:image_edits": return gpt_image_2.save(result, output)
    default: die(`unknown endpoint: ${endpoint}`)
  }
}

function endpoint_kind(endpoint: string): "image" | "video" {
  switch (endpoint) {
    case "t3:seedance2": return "video"
    case "byteplus:seedream-4-5":
    case "byteplus:seedream-5-0":
    case "google:nano_banana_2":
    case "google:nano_banana_pro":
    case "openai:image_generations":
    case "openai:image_edits": return "image"
    default: die(`unknown endpoint: ${endpoint}`)
  }
}
