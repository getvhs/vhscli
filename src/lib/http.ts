import { die } from "./error.js"

// fetch() has no built-in timeout, so we wrap it with an AbortController.
// CRITICAL: clearTimeout(timer) in finally is what lets the cli exit. node
// keeps the event loop alive while a setTimeout is pending — without the
// clear, the process blocks for the full timeout_ms after the fetch has
// already resolved
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
