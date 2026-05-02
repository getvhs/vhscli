import { z } from "zod"
import { die } from "./error.js"

// fetch() has no built-in timeout, so we wrap it with an AbortController.
// CRITICAL: clearTimeout(timer) in finally is what lets the cli exit. node
// keeps the event loop alive while a setTimeout is pending — without the
// clear, the process blocks for the full timeout_ms after the fetch has
// already resolved, showing up as the cli hanging at the end of every
// command for 15s/60s/300s depending on the call's timeout.
export async function kfetch(input: string | URL, init: RequestInit & { timeout_ms: number }) {
  const { timeout_ms, ...rest } = init
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout_ms)

  try {
    return await fetch(input, { ...rest, signal: ac.signal })
  } catch (err) {
    if (ac.signal.aborted) die("request timed out")
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export function zparse<T extends z.ZodType>(schema: T, value: unknown, message = "schema mismatch"): z.infer<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  const json = JSON.stringify(value, null, 2)
  const truncated = json.length > 1000 ? json.slice(0, 1000) + "..." : json
  console.error(`${message}:`)
  console.error(truncated)
  for (const issue of result.error.issues) {
    console.error(` ${issue.path.join(".")}: ${issue.message.toLowerCase()}`)
  }
  process.exit(1)
}
