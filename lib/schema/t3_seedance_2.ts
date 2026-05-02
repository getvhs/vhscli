import { z } from "zod"

const frame_image = z.object({
  type: z.literal("image_url"),
  frame_type: z.enum(["first_frame", "last_frame"]),
  image_url: z.object({ url: z.string() }),
})

const image_reference = z.object({
  type: z.literal("image_url"),
  image_url: z.object({ url: z.string() }),
})

const video_reference = z.object({
  type: z.literal("video_url"),
  video_url: z.object({ url: z.string() }),
  role: z.enum(["edit_source", "extend_source"]).optional(),
})

const input_reference = z.discriminatedUnion("type", [image_reference, video_reference])

export const request = z.object({
  model: z.literal("seedance-2.0"),
  prompt: z.string(),
  duration: z.number().int().optional(),
  resolution: z.enum(["360p", "480p", "540p", "720p", "1080p", "1K", "2K", "4K"]).optional(),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"]).optional(),
  generate_audio: z.boolean().optional(),
  seed: z.number().int().optional(),
  watermark: z.boolean().optional(),
  frame_images: z.array(frame_image).optional(),
  input_references: z.array(input_reference).optional(),
})

export const response = z.looseObject({
  id: z.string(),
  object: z.literal("video"),
  status: z.literal("completed"),
  url: z.string(),
  video_url: z.string().nullish(),
  duration: z.number().int(),
})

export const intermediate = z.looseObject({
  id: z.string().nullish(),
  error: z.looseObject({
    code: z.string().optional(),
    type: z.string().optional(),
    message: z.string(),
  }).nullish(),
}).refine((d) => d.id || d.error, "must contain id or error")
