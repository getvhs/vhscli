import { z } from "zod"
import { die } from "./error.js"
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
  const res = await invoke(sess, "main2/submit", { task_id }, submit_response, timeout_ms)
  if (!res.ok) die(res.err)
  return { task_id, result: res.result, intermediate: res.intermediate }
}
