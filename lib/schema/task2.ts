import { z } from "zod"

export const task2 = z.object({
  endpoint: z.string().optional(),
  payload: z.unknown().optional(),
  result: z.unknown().optional(),
  err: z.string().nullable().optional(),
})
