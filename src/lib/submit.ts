import * as backend from "./backend.js"
import { insert_task } from "./db.js"
import { type Session } from "./session.js"

// returns err to the caller instead of dying so endpoint-specific code can
// inspect it (e.g. seedance falls back to t3 on real-face rejection).
export async function submit(
  sess: Session,
  endpoint: string,
  payload: Record<string, unknown>,
  message: string,
  timeout_ms: number,
): Promise<{ task_id: string; result?: unknown; intermediate?: unknown; err?: string }> {
  const task_id = crypto.randomUUID()
  console.log(`task_id: ${task_id}`)
  await insert_task(sess, task_id, endpoint, payload)

  console.log(message)
  const res = await backend.submit(sess, task_id, timeout_ms)
  return res.ok
    ? { task_id, result: res.result, intermediate: res.intermediate }
    : { task_id, err: res.err }
}
