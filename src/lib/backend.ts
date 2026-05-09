import { z } from "zod"
import { die } from "./error.js"
import { kfetch } from "./http.js"
import { supabase_anon_key, supabase_url, type Session } from "./session.js"
import { kparse } from "./parse.js"

// our backend uses rpc over http, not rest. every call either succeeds with
// `{ok: true, ...}` or fails with `{ok: false, err}`. a non-200 status code
// or a timeout means the rpc layer itself broke (gateway, auth, network) —
// always fatal. application-level `ok: false` is also fatal too, so the
// backend.* helpers below check it and die. provider-level errors (e.g.
// byteplus real-face rejection) come back as `err` on a successful poll2
// response, not as `ok: false` here.
async function invoke<T extends z.ZodType>(
  sess: Session,
  fn: string,
  body: Record<string, unknown>,
  schema: T,
  timeout_ms: number,
): Promise<z.infer<T>> {
  const res = await kfetch(`${supabase_url}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      apikey: supabase_anon_key,
      authorization: `Bearer ${sess.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    timeout_ms,
  })
  if (!res.ok) die(`edge function error: ${res.status} ${await res.text()}`)
  return kparse(schema, await res.json(), `bad ${fn} response`)
}

const bootstrap_response = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), account_id: z.string(), is_new: z.boolean() }),
  z.object({ ok: z.literal(false), err: z.string() }),
])

export async function bootstrap(sess: Session) {
  const res = await invoke(sess, "main2/bootstrap", {}, bootstrap_response, 30_000)
  if (!res.ok) die(`main2/bootstrap: ${res.err}`)
  return res
}

const submit2_response = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), err: z.string() }),
])

// non-blocking submit. backend kicks off provider work in waitUntil and
// returns immediately. result/err arrive later via poll2 (or poll/t3 for
// the t3 endpoint, which drives the upstream poller).
export async function submit2(sess: Session, task_id: string) {
  const res = await invoke(sess, "main2/submit2", { task_id }, submit2_response, 30_000)
  if (!res.ok) die(`main2/submit2: ${res.err}`)
  return res
}

const poll2_response = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    is_completed: z.boolean(),
    completed_at: z.string().nullable().default(null),
    result: z.unknown().nullable().default(null),
    err: z.string().nullable().default(null),
  }),
  z.object({ ok: z.literal(false), err: z.string() }),
])

// long-poll: server blocks up to 40s waiting for a realtime broadcast that
// the task finalized. on completion returns result + err inline.
export async function poll2(sess: Session, task_id: string) {
  const res = await invoke(sess, "main2/poll2", { task_id }, poll2_response, 60_000)
  if (!res.ok) die(`main2/poll2: ${res.err}`)
  return res
}

const poll_t3_response = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), is_completed: z.boolean() }),
  z.object({ ok: z.literal(false), err: z.string() }),
])

// drives the t3 upstream poller for one ~40s window. unlike poll2 this is
// pull-based; the t3 endpoint has no broadcast.
export async function poll_t3(sess: Session, task_id: string) {
  const res = await invoke(sess, "main2/poll/t3", { task_id }, poll_t3_response, 60_000)
  if (!res.ok) die(`main2/poll/t3: ${res.err}`)
  return res
}

// server returns the upstream provider's id under its native name; alias it
// to asset_id so the rest of the cli stays vendor-agnostic.
const new_asset_response = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), token360_asset_id: z.string() })
    .transform((r) => ({ ok: true as const, asset_id: r.token360_asset_id })),
  z.object({ ok: z.literal(false), err: z.string() }),
])

export async function new_asset(sess: Session, media_url: string) {
  const res = await invoke(sess, "t3/new_asset", { media_url }, new_asset_response, 90_000)
  if (!res.ok) die(`t3/new_asset: ${res.err}`)
  return res
}
