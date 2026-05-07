import * as backend from "./backend.js"
import { insert_task } from "./db.js"
import { type Session } from "./session.js"

// insert task2 row + non-blocking submit2. returns task_id; caller waits via
// wait_for_task (or poll_t3 loop for the t3 endpoint).
export async function create_and_submit(
  sess: Session,
  endpoint: string,
  payload: Record<string, unknown>,
) {
  const task_id = crypto.randomUUID()
  console.log(`task_id: ${task_id}`)
  await insert_task(sess, task_id, endpoint, payload)
  await backend.submit2(sess, task_id)
  return task_id
}

// long-poll until the task finalizes, printing progress between rounds.
// returns {result, err} — caller decides whether err is fatal or a fallback
// trigger.
export async function wait_for_task(sess: Session, task_id: string) {
  const start = Date.now()
  while (true) {
    const res = await backend.poll2(sess, task_id)
    if (res.is_completed) return { result: res.result, err: res.err }
    console.log(`polling... ${Math.round((Date.now() - start) / 1000)}s`)
  }
}
