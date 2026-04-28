import { die } from "../lib/error.js"
import { load_session } from "../lib/session.js"
import { auth } from "./auth.js"

export async function get_session() {
  const first = await load_session()
  if (first) return first

  console.log("no valid session. launching auth...")
  await auth()

  const second = await load_session()
  if (!second) die("auth failed")
  return second
}
