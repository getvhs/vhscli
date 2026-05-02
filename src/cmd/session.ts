import { die } from "../lib/error.js"
import { load_session } from "../lib/session.js"
import { login } from "./login.js"

export async function get_session() {
  const existing = await load_session()
  if (existing) return existing

  console.log("no valid session. launching login...")
  await login()

  const session = await load_session()
  if (!session) die("login failed")
  return session
}
