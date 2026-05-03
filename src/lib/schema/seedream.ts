import { z } from "zod"

const base = {
  prompt: z.string(),
  image: z.union([z.string(), z.array(z.string()).max(14)]).optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
  watermark: z.boolean().optional(),
  stream: z.boolean().optional(),
  sequential_image_generation: z.enum(["auto", "disabled"]).optional(),
  sequential_image_generation_options: z.object({ max_images: z.number().int().min(1).max(15) }).optional(),
  optimize_prompt_options: z.object({ mode: z.literal("standard") }).optional(),
}

export const request = z.discriminatedUnion("model", [
  z.object({
    model: z.literal("seedream-4-5-251128"),
    size: z.union([z.enum(["2K", "4K"]), z.string().regex(/^\d+x\d+$/)]).optional(),
    ...base,
  }),
  z.object({
    model: z.literal("seedream-5-0-260128"),
    size: z.union([z.enum(["2K", "3K"]), z.string().regex(/^\d+x\d+$/)]).optional(),
    ...base,
  }),
])

export const response = z.object({
  model: z.string().nullable().default(null),
  created: z.number().nullable().default(null),
  data: z.array(z.object({
    url: z.string().nullable().default(null),
    b64_json: z.string().nullable().default(null),
    size: z.string().nullable().default(null),
    error: z.object({ message: z.string() }).nullable().default(null),
  })).min(1),
  usage: z.object({
    generated_images: z.number().nullable().default(null),
    output_tokens: z.number().nullable().default(null),
    total_tokens: z.number().nullable().default(null),
  }).nullable().default(null),
})
