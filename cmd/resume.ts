import { Command } from "commander"
import { die } from "../lib/error.js"
import * as seedance_schema from "../lib/schema/seedance_2.js"
import { type Session } from "../lib/session.js"
import { invoke, pg_get } from "../lib/supabase.js"
import { zparse } from "../lib/util.js"
import * as gpt_image_2 from "./generate/gpt_image_2.js"
import * as nano_banana_2 from "./generate/nano_banana_2.js"
import * as nano_banana_pro from "./generate/nano_banana_pro.js"
import * as seedance_2 from "./generate/seedance_2.js"
import * as seedream_4_5 from "./generate/seedream_4_5.js"
import * as seedream_5 from "./generate/seedream_5.js"
import { save_t3_seedance_2_result } from "../lib/t3.js"
import { get_session } from "./session.js"

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
  while (true) {
    const data = await pg_get(sess, "task2", "endpoint, payload, result, err", task_id)
    if (!data) die(`task not found: ${task_id}`)
    if (data.err) die(data.err)
    if (data.result) {
      await save_result(sess, task_id, data.endpoint, data.payload, data.result, opts.output ?? null)
      return
    }
    if (data.endpoint === "t3:seedance2") {
      const poll_res = await invoke(sess, "main2/poll/t3", { task_id }, 60_000)
      if (!poll_res.ok) die(poll_res.err)
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function save_result(sess: Session, task_id: string, endpoint: string, payload: unknown, result: unknown, output: string | null) {
  switch (endpoint) {
    case "byteplus:seedance-2-0": return seedance_2.save(sess, task_id, zparse(seedance_schema.request, payload, "bad seedance-2 payload"), output)
    case "t3:seedance2": return save_t3_seedance_2_result(result, output)
    case "byteplus:seedream-4-5": return seedream_4_5.save(result, output)
    case "byteplus:seedream-5-0": return seedream_5.save(result, output)
    case "google:nano_banana_2": return nano_banana_2.save(result, output)
    case "google:nano_banana_pro": return nano_banana_pro.save(result, output)
    case "openai:image_generations":
    case "openai:image_edits": return gpt_image_2.save(result, output)
    default: die(`unknown endpoint: ${endpoint}`)
  }
}
