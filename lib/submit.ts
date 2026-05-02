import { die } from "./error.js"
import { type Session } from "./session.js"
import { invoke, pg_insert } from "./supabase.js"

export async function submit(
  sess: Session,
  endpoint: string,
  payload: unknown,
  message: string,
  timeout_ms: number,
): Promise<{ task_id: string; result?: unknown; intermediate?: unknown }> {
  const task_id = crypto.randomUUID()
  console.log(`task_id: ${task_id}`)
  await pg_insert(sess, "task2", {
    id: task_id,
    user_id: sess.user_id,
    endpoint,
    payload,
  })

  console.log(message)
  const submit_res = await invoke(sess, "main2/submit", { task_id }, timeout_ms)
  if (!submit_res.ok) die(submit_res.err)
  return { task_id, result: submit_res.result, intermediate: submit_res.intermediate }
}
