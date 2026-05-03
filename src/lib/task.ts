import * as backend from "./backend.js"
import { insert_task } from "./db.js"
import { type Session } from "./session.js"

export async function create_and_submit(
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
