import { z } from "zod"
import { die } from "./error.js"
import { kfetch } from "./http.js"
import { auth_headers, supabase_url, type Session } from "./session.js"
import { kparse } from "./parse.js"

const jsonb = z.record(z.string(), z.unknown())

// postgrest returns every selected column — null for unset, never absent —
// so jsonb columns must be nullable in the schema, not just optional.
const task2 = z.object({
  endpoint: z.string().nullish(),
  result: jsonb.nullish(),
  intermediate: jsonb.nullish(),
  err: z.string().nullish(),
})

export async function insert_task(
  sess: Session,
  task_id: string,
  endpoint: string,
  payload: Record<string, unknown>,
) {
  await pg_insert(sess, "task2", { id: task_id, user_id: sess.user_id, endpoint, payload })
}

export async function get_task(sess: Session, task_id: string) {
  return pg_get(sess, "task2", task2, "endpoint, result, intermediate, err", task_id)
}

async function pg_insert(sess: Session, table: string, row: Record<string, unknown>) {
  const res = await kfetch(`${supabase_url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...auth_headers(sess), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(row),
    timeout_ms: 15_000,
  })

  if (!res.ok) die(`insert failed: ${res.status} ${await res.text()}`)
}

async function pg_get<T extends z.ZodType>(
  sess: Session,
  table: string,
  schema: T,
  select: string,
  id: string,
): Promise<z.infer<T> | null> {
  const url = new URL(`${supabase_url}/rest/v1/${table}`)
  url.searchParams.set("select", select)
  url.searchParams.set("id", `eq.${id}`)
  url.searchParams.set("limit", "1")

  const res = await kfetch(url, { headers: auth_headers(sess), timeout_ms: 15_000 })
  if (!res.ok) die(`query failed: ${res.status} ${await res.text()}`)

  const rows = await res.json()
  if (!Array.isArray(rows)) die(`bad ${table} response`)
  const row = rows[0]
  if (row == null) return null
  return kparse(schema, row, `bad ${table} row`)
}
