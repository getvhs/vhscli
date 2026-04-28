import { die } from "./error.js"

export async function read_prompt(prompt: string) {
  if (prompt !== "-") return prompt

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }

  const text = Buffer.concat(chunks).toString("utf8").trim()
  if (!text) die("empty prompt")
  return text
}
