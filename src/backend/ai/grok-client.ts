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

  let text = ""

  for await (const event of stream) {
    if (isVerboseLogging()) {
      const { type, ...rest } = event as any
      console.log(`[Grok] SSE ${type} ${JSON.stringify(rest)}`)
    }

    onEvent?.(event)

    switch (event.type) {
      case "response.output_text.delta":
        text += event.delta
        break

      case "response.completed":
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

  return text
}
