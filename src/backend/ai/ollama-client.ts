import type { JsonSchemaSpec } from "./ai-engine-adapter.js"

/** Native Ollama chat message. */
export interface OllamaMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface OllamaChatRequest {
  model: string
  messages: OllamaMessage[]
  stream: true
  /** JSON Schema for structured output, or "json" for free-form JSON. */
  format?: Record<string, unknown> | "json"
  think?: boolean
  options?: {
    temperature?: number
    top_p?: number
    num_ctx?: number
    num_predict?: number
  }
}

/** One decoded line of the NDJSON stream. */
export interface OllamaChatChunk {
  message?: { content?: string; thinking?: string }
  done?: boolean
  done_reason?: string
  error?: string
  prompt_eval_count?: number
  eval_count?: number
}

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"

export function buildChatRequest(args: {
  model: string
  systemPrompt: string | null
  userPrompt: string | null
  settings: {
    temperature?: number
    top_p?: number
    num_ctx?: number
    max_output_tokens?: number
    think?: boolean
  }
  responseSchema?: JsonSchemaSpec
  enforceSchema?: boolean
}): OllamaChatRequest {
  const messages: OllamaMessage[] = []
  if (args.systemPrompt?.trim()) messages.push({ role: "system", content: args.systemPrompt })
  messages.push({ role: "user", content: args.userPrompt ?? "" })

  const options: OllamaChatRequest["options"] = {}
  if (isPositive(args.settings.temperature)) options.temperature = args.settings.temperature
  if (isPositive(args.settings.top_p)) options.top_p = args.settings.top_p
  if (isPositive(args.settings.num_ctx)) options.num_ctx = args.settings.num_ctx
  if (isPositive(args.settings.max_output_tokens)) options.num_predict = args.settings.max_output_tokens

  const req: OllamaChatRequest = { model: args.model, messages, stream: true }
  if (Object.keys(options).length > 0) req.options = options
  if (args.settings.think === false) req.think = false
  if (args.responseSchema && args.enforceSchema !== false) req.format = args.responseSchema.schema

  return req
}

function isPositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
}

/** Split a growing NDJSON buffer into complete lines, returning the remainder. */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n")
  const rest = parts.pop() ?? ""
  return { lines: parts.filter((l) => l.trim().length > 0), rest }
}

export async function* streamOllamaChat(
  baseUrl: string,
  request: OllamaChatRequest,
  abortSignal: AbortSignal,
): AsyncGenerator<OllamaChatChunk> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/chat`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: abortSignal,
  })

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Ollama ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 500)}` : ""}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { lines, rest } = takeLines(buffer)
      buffer = rest
      for (const line of lines) {
        let chunk: OllamaChatChunk
        try {
          chunk = JSON.parse(line) as OllamaChatChunk
        } catch {
          continue
        }
        if (chunk.error) throw new Error(`Ollama: ${chunk.error}`)
        yield chunk
      }
    }
    if (buffer.trim().length > 0) {
      try {
        yield JSON.parse(buffer) as OllamaChatChunk
      } catch {
        /* trailing garbage — ignore */
      }
    }
  } finally {
    reader.releaseLock()
  }
}
