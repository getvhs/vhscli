import { z } from "zod"

// shapes for `a1:*` endpoints. mirrors packages/model_schemas/simple_*.ts
// in vhs-main. payloads are sent verbatim and persisted by the backend;
// responses come back parsed through these on the cli side.

export const simple_image_request = z.object({
  prompt: z.string(),
  size: z.string(),
  input_image: z.array(z.string()).optional(),
})

export const simple_image_response = z.object({
  image_url: z.string(),
  output_format: z.string().nullable().default(null),
  usage: z.record(z.string(), z.unknown()).nullable().default(null),
})

export const simple_video_request = z.object({
  prompt: z.string(),
  input_image: z.array(z.string()).optional(),
  input_audio: z.array(z.string()).optional(),
  input_video: z.array(z.string()).optional(),
  first_frame: z.string().optional(),
  last_frame: z.string().optional(),
  duration: z.number().int(),
  output_audio: z.boolean(),
  resolution: z.string(),
  ratio: z.string(),
})

export const simple_video_response = z.object({
  video_url: z.string(),
  usage: z.record(z.string(), z.unknown()).nullable().default(null),
})
