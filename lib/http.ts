import { die } from "./error.js"

export async function fetch_with_timeout(input: string | URL, init: RequestInit & { timeout_ms: number }) {
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
