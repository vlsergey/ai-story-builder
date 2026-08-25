import { Buffer } from "node:buffer"
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

/**
 * How long the socket may stay silent before we call it dead.
 *
 * NOT a deadline on the whole call and NOT a deadline on the first header —
 * a local model legitimately spends many minutes evaluating a long prompt
 * before it emits anything. This only catches a connection that has stopped
 * delivering bytes altogether.
 */
export const OLLAMA_IDLE_TIMEOUT_MS = 30 * 60 * 1000

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
  for await (const line of streamLines(baseUrl, request, abortSignal)) {
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

/**
 * Raw NDJSON lines over node:http.
 *
 * Deliberately NOT global `fetch`: undici imposes a five-minute
 * `headersTimeout`, and Ollama withholds response headers while the model
 * evaluates the prompt. A long prompt on a local model routinely exceeds that,
 * and the call dies as `TypeError: fetch failed` / `UND_ERR_HEADERS_TIMEOUT`
 * before the first byte of output exists. `http.request` imposes no such
 * deadline, so the only limit is the caller's abort signal.
 */
async function* streamLines(
  baseUrl: string,
  request: OllamaChatRequest,
  abortSignal: AbortSignal,
): AsyncGenerator<string> {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/api/chat`)
  const transport = url.protocol === "https:" ? await import("node:https") : await import("node:http")
  const body = JSON.stringify(request)

  const res = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      resolve,
    )
    req.on("error", reject)
    req.setTimeout(OLLAMA_IDLE_TIMEOUT_MS, () => {
      req.destroy(
        new Error(`Ollama: no data for ${Math.round(OLLAMA_IDLE_TIMEOUT_MS / 60000)} min — connection is dead`),
      )
    })
    abortSignal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true })
    req.end(body)
  })

  if (!res.statusCode || res.statusCode >= 400) {
    const detail = await readAll(res)
    throw new Error(`Ollama ${res.statusCode} ${res.statusMessage ?? ""}${detail ? `: ${detail.slice(0, 500)}` : ""}`)
  }

  res.setEncoding("utf8")
  let buffer = ""
  for await (const piece of res) {
    if (abortSignal.aborted) throw new Error("aborted")
    buffer += piece as string
    const { lines, rest } = takeLines(buffer)
    buffer = rest
    for (const line of lines) yield line
  }
  if (buffer.trim().length > 0) yield buffer
}

async function readAll(res: import("node:http").IncomingMessage): Promise<string> {
  let out = ""
  res.setEncoding("utf8")
  for await (const piece of res) out += piece as string
  return out
}
