import { z } from "zod"

const content_part = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input_text"), text: z.string() }),
  z.object({ type: z.literal("input_image"), image_url: z.string() }),
  z.object({ type: z.literal("input_video"), video_url: z.string(), fps: z.number().min(0.2).max(5).optional() }),
  z.object({ type: z.literal("input_file"), file_url: z.string() }),
])

export const Request = z.object({
  model: z.literal("seed-2-0-lite-260228"),
  input: z.array(z.object({
    role: z.literal("user"),
    content: z.array(content_part).min(1),
  })).min(1),
  stream: z.boolean().optional(),
})

export const MessageOutput = z.object({
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.array(z.object({
    type: z.literal("output_text"),
    text: z.string(),
  })).min(1),
})

export const Response = z.object({
  id: z.string(),
  object: z.literal("response"),
  status: z.string(),
  output: z.array(z.looseObject({ type: z.string() })).min(1),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    total_tokens: z.number(),
  }).optional(),
})
