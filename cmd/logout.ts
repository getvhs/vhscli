import { delete_creds } from "../lib/session.js"

export async function logout() {
  await delete_creds()
  console.log("logged out")
}
