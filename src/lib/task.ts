import * as backend from "./backend.js"
import { insert_task } from "./db.js"
import { type Session } from "./session.js"

// returns the discriminated backend response (caller branches on .ok) plus
// the task_id we minted; seedance inspects the err to decide on t3 fallback.
export async function submit(
  sess: Session,
  endpoint: string,
  payload: Record<string, unknown>,
  message: string,
  timeout_ms: number,
) {
  const task_id = crypto.randomUUID()
  console.log(`task_id: ${task_id}`)
  await insert_task(sess, task_id, endpoint, payload)

  console.log(message)
  const res = await backend.submit(sess, task_id, timeout_ms)
  return { task_id, ...res }
}
