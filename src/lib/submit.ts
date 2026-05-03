import * as backend from "./backend.js"
import { type Session } from "./session.js"
import { pg_insert } from "./supabase.js"

// returns err to the caller instead of dying so endpoint-specific code can
// inspect it (e.g. seedance falls back to t3 on real-face rejection).
export async function submit(
  sess: Session,
  endpoint: string,
  payload: unknown,
  message: string,
  timeout_ms: number,
): Promise<{ task_id: string; result?: unknown; intermediate?: unknown; err?: string }> {
  const task_id = crypto.randomUUID()
  console.log(`task_id: ${task_id}`)
  await pg_insert(sess, "task2", {
    id: task_id,
    user_id: sess.user_id,
    endpoint,
    payload,
  })

  console.log(message)
  const res = await backend.submit(sess, task_id, timeout_ms)
  return res.ok
    ? { task_id, result: res.result, intermediate: res.intermediate }
    : { task_id, err: res.err }
}
