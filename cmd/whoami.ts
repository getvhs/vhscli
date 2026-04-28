import { get_session } from "./session.js"

export async function whoami() {
  const { user_id, email } = await get_session()
  console.log(email ?? user_id)
}
