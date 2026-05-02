import { die } from "../lib/error.js"
import { load_session } from "../lib/session.js"

export async function whoami() {
  const session = await load_session()
  if (!session) die("not logged in")
  console.log(session.email ?? session.user_id)
}
