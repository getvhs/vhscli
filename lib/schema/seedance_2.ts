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

export const Request = z.object({
  model: z.literal("dreamina-seedance-2-0-260128"),
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

export const Response = z.object({
  id: z.string(),
  status: z.literal("succeeded"),
  content: z.object({
    video_url: z.string(),
    last_frame_url: z.string().optional(),
  }),
})
