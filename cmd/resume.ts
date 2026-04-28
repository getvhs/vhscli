import { Command } from "commander"
import { die } from "../lib/error.js"
import { pg_get } from "../lib/supabase.js"
import { save_gpt_image_2_result } from "./generate/gpt_image_2.js"
import { save_nano_banana_2_result } from "./generate/nano_banana_2.js"
import { save_nano_banana_pro_result } from "./generate/nano_banana_pro.js"
import { save_seedance_2_result } from "./generate/seedance_2.js"
import { save_seedream_4_5_result } from "./generate/seedream_4_5.js"
import { save_seedream_5_result } from "./generate/seedream_5.js"
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
    const data = await pg_get(sess, "task2", "endpoint, result, err", task_id)
    if (!data) die(`task not found: ${task_id}`)
    if (data.err) die(data.err)
    if (data.result) {
      await save_result(data.endpoint, data.result, opts.output ?? null)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function save_result(endpoint: string, result: unknown, output: string | null) {
  switch (endpoint) {
    case "byteplus:seedance-2-0": return save_seedance_2_result(result, output)
    case "byteplus:seedream-4-5": return save_seedream_4_5_result(result, output)
    case "byteplus:seedream-5-0": return save_seedream_5_result(result, output)
    case "google:nano_banana_2": return save_nano_banana_2_result(result, output)
    case "google:nano_banana_pro": return save_nano_banana_pro_result(result, output)
    case "openai:image_generations":
    case "openai:image_edits": return save_gpt_image_2_result(result, output)
    default: die(`unknown endpoint: ${endpoint}`)
  }
}
