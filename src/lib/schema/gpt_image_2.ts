import { z } from "zod"

const image_ref = z.object({ image_url: z.string() })

export const request = z.object({
  model: z.literal("gpt-image-2"),
  prompt: z.string(),
  images: z.array(image_ref).optional(),
  mask: image_ref.optional(),
  size: z.string().optional(),
  output_format: z.enum(["png", "jpeg", "webp"]),
  moderation: z.literal("low"),
})

const token_details = z.object({
  text_tokens: z.number(),
  image_tokens: z.number(),
})

export const response = z.looseObject({
  created: z.number().optional(),
  output_format: z.string().optional(),
  quality: z.string().optional(),
  size: z.string().optional(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    total_tokens: z.number(),
    input_tokens_details: token_details,
    output_tokens_details: token_details,
  }),
  data: z.array(z.object({
    url: z.string(),
    revised_prompt: z.string().optional(),
  })).min(1),
})
