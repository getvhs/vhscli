import { z } from "zod"

const content = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string() }),
    role: z.enum(["first_frame", "last_frame", "reference_image"]).optional(),
  }),
  z.object({
    type: z.literal("video_url"),
    video_url: z.object({ url: z.string() }),
    role: z.literal("reference_video").optional(),
  }),
  z.object({
    type: z.literal("audio_url"),
    audio_url: z.object({ url: z.string() }),
    role: z.literal("reference_audio").optional(),
  }),
])

// byteplus seedance-2 request shape, sent to t3 in passthrough mode
// (Token360-Native-Params: true). model is the t3 platform id, not the
// byteplus one (`dreamina-seedance-2-0-260128`).
export const request = z.object({
  model: z.literal("seedance-2.0"),
  content: z.array(content).min(1),
  return_last_frame: z.boolean().optional(),
  service_tier: z.literal("default").optional(),
  execution_expires_after: z.number().int().min(3600).max(259200).optional(),
  generate_audio: z.boolean().optional(),
  safety_identifier: z.string().max(64).optional(),
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  ratio: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]).optional(),
  duration: z.number().int().refine((v) => v === -1 || (v >= 4 && v <= 15)).optional(),
  seed: z.number().int().min(-1).max(4294967295).optional(),
  watermark: z.boolean().optional(),
})

// t3 /v1/videos/{id} completed response (t3 wrapper shape).
export const response = z.looseObject({
  id: z.string(),
  object: z.literal("video"),
  status: z.literal("completed"),
  url: z.string(),
  video_url: z.string().nullable().default(null),
  duration: z.number().int(),
})
