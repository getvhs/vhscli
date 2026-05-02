import { z } from "zod"
import { type Session } from "./session.js"
import { invoke, pg_insert } from "./supabase.js"

export const submit_response = z.discriminatedUnion("ok", [
  z.looseObject({
    ok: z.literal(true),
    result: z.unknown().optional(),
    intermediate: z.unknown().optional(),
  }),
  z.object({ ok: z.literal(false), err: z.string() }),
])

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
  const res = await invoke(sess, "main2/submit", { task_id }, submit_response, timeout_ms)
  return res.ok
    ? { task_id, result: res.result, intermediate: res.intermediate }
    : { task_id, err: res.err }
}
