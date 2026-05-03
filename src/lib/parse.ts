import { z } from "zod"

export function kparse<T extends z.ZodType>(schema: T, value: unknown, message: string): z.infer<T> {
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
