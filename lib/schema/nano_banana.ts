import { z } from "zod"

const part = z.union([
  z.object({ text: z.string() }),
  z.object({ inlineData: z.object({ mimeType: z.string(), url: z.string() }) }),
])

const content = z.object({
  role: z.enum(["user", "model"]).optional(),
  parts: z.array(part),
})

const google_search_tool = z.object({
  googleSearch: z.object({
    searchTypes: z.object({
      webSearch: z.object({}).optional(),
      imageSearch: z.object({}).optional(),
    }).optional(),
  }),
})

const generation_config = z.object({
  responseModalities: z.array(z.enum(["TEXT", "IMAGE"])).optional(),
  imageConfig: z.object({
    aspectRatio: z.enum([
      "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1",
      "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9",
    ]).optional(),
    imageSize: z.enum(["512", "1K", "2K", "4K"]).optional(),
  }).optional(),
  thinkingConfig: z.object({
    thinkingLevel: z.enum(["minimal", "low", "medium", "high"]).optional(),
    includeThoughts: z.boolean().optional(),
  }).optional(),
})

export const Request = z.object({
  contents: z.array(content),
  systemInstruction: content.optional(),
  tools: z.array(google_search_tool).optional(),
  generationConfig: generation_config.optional(),
})

const response_part = z.object({
  text: z.string().optional(),
  inlineData: z.object({ mimeType: z.string(), url: z.string() }).optional(),
  thoughtSignature: z.string().optional(),
  thought: z.boolean().optional(),
})

export const Response = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(response_part).optional() }),
    finishReason: z.string().optional(),
    groundingMetadata: z.unknown().optional(),
  })).min(1),
})
