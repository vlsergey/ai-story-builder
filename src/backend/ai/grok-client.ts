import OpenAI from "openai"
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js"
import lastAiGenerationEventManager from "../ai/last-ai-generation-event-manager.js"
import { isVerboseLogging, makeLoggingFetch } from "./ai-logging.js"

const GROK_BASE = "https://api.x.ai/v1"

/** Creates an OpenAI-compatible client pointed at the xAI Grok API with request/response logging. */
export function createGrokClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: GROK_BASE,
    fetch: makeLoggingFetch("Grok", GROK_BASE),
    timeout: 5 * 60 * 1000, // 5 minutes — Grok reasoning models can be slow
    maxRetries: 0, // disable automatic retries — Grok requests are expensive and slow
  })
}

/**
 * Calls the xAI Responses API in streaming mode and returns the full text output.
 * Logs reasoning summary and web search events to the console.
 * Optional callbacks allow the caller to react to thinking status changes and text deltas.
 */
export async function grokGenerate(
  abortSignal: AbortSignal | null,
  apiKey: string,
  params: Omit<ResponseCreateParamsStreaming, "stream">,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<string> {
  const client = createGrokClient(apiKey)

  const stream = await client.responses.create(
    {
      ...params,
      stream: true,
    } satisfies ResponseCreateParamsStreaming,
    {
      signal: abortSignal,
    },
  )

  // Text deltas carry the index of the output item they belong to, and a
  // response may hold more than one text item. Seen on grok-4.7 under a
  // json_schema: an empty object in item 0, the real findings in item 1.
  // Gluing every delta into one string then yields valid JSON followed by
  // junk, which JSON.parse rejects at the character where the second object
  // starts. So keep the items apart and answer with the last one that said
  // anything — one call asks one question and wants one answer.
  const itemText = new Map<number, string>()
  const itemOrder: number[] = []
  const answer = () => {
    for (let i = itemOrder.length - 1; i >= 0; i--) {
      const candidate = itemText.get(itemOrder[i]) ?? ""
      if (candidate.length > 0) return candidate
    }
    return ""
  }
  // A call that yields no answer must say why: an empty string passes for
  // success, and the caller then fails on "an empty answer" with the reason lost.
  let completed = false
  let refusal = ""
  let lastEventType = "none"

  for await (const event of stream) {
    if (isVerboseLogging()) {
      const { type, ...rest } = event as any
      console.log(`[Grok] SSE ${type} ${JSON.stringify(rest)}`)
    }

    onEvent?.(event)
    lastEventType = event.type

    switch (event.type) {
      case "response.output_text.delta": {
        const rawIndex = (event as { output_index?: unknown }).output_index
        const index = typeof rawIndex === "number" ? rawIndex : 0
        if (!itemText.has(index)) itemOrder.push(index)
        itemText.set(index, (itemText.get(index) ?? "") + event.delta)
        break
      }

      case "response.refusal.delta":
        refusal += event.delta
        break

      case "error":
        throw new Error(`Grok stream error: ${event.code ?? "no code"}: ${event.message}`)

      case "response.completed":
        completed = true
        lastAiGenerationEventManager.onAiGenerationEvent({ ...event.response?.usage })
        break

      case "response.failed":
        throw new Error(`Grok response failed: ${JSON.stringify((event.response as { error?: unknown }).error ?? {})}`)

      case "response.incomplete":
        console.warn(
          "[Grok] response incomplete:",
          JSON.stringify((event.response as { incomplete_details?: unknown }).incomplete_details ?? {}),
        )
        throw new Error(
          "[Grok] response incomplete: " +
            JSON.stringify((event.response as { incomplete_details?: unknown }).incomplete_details ?? {}),
        )
    }
  }

  // A stop ends the stream quietly too; the caller knows its own signal.
  if (abortSignal?.aborted) return answer()
  if (refusal) throw new Error(`Grok refused: ${refusal}`)
  if (!completed) throw new Error(`Grok stream ended before the response completed (last event: ${lastEventType})`)
  return answer()
}
