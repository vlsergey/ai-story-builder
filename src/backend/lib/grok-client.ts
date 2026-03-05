import OpenAI from 'openai'
import type { ResponseCreateParamsStreaming } from 'openai/resources/responses/responses.js'
import { makeLoggingFetch } from './yandex-client.js'

const GROK_BASE = 'https://api.x.ai/v1'

/** Creates an OpenAI-compatible client pointed at the xAI Grok API with request/response logging. */
export function createGrokClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: GROK_BASE,
    fetch: makeLoggingFetch('Grok', GROK_BASE),
    timeout: 5 * 60 * 1000, // 5 minutes — Grok reasoning models can be slow
    maxRetries: 0,           // disable automatic retries — Grok requests are expensive and slow
  })
}

/**
 * Calls the xAI Responses API in streaming mode and returns the full text output.
 * Logs reasoning summary and web search events to the console.
 * Optional callbacks allow the caller to react to thinking status changes and text deltas.
 */
export async function grokGenerate(
  apiKey: string,
  params: Record<string, unknown>,
  onThinking?: (status: string) => void,
  onDelta?: (text: string) => void,
): Promise<string> {
  const client = createGrokClient(apiKey)

  const stream = await client.responses.create({
    ...params,
    stream: true,
  } as ResponseCreateParamsStreaming)

  let text = ''

  for await (const event of stream) {
    switch (event.type) {
      case 'response.output_text.delta':
        text += event.delta
        onDelta?.(event.delta)
        break

      case 'response.reasoning_summary_text.done':
        if (event.text) {
          console.log(`[Grok] reasoning summary:\n${event.text}`)
          onThinking?.('reasoning_done')
        }
        break

      case 'response.reasoning_text.done':
        if (event.text) {
          console.log(`[Grok] reasoning:\n${event.text}`)
        }
        break

      case 'response.web_search_call.in_progress':
        console.log('[Grok] web search: in progress')
        onThinking?.('web_search_in_progress')
        break

      case 'response.web_search_call.searching':
        console.log('[Grok] web search: searching')
        onThinking?.('web_search_searching')
        break

      case 'response.web_search_call.completed':
        console.log('[Grok] web search: completed')
        onThinking?.('web_search_completed')
        break

      case 'response.failed':
        throw new Error(`Grok response failed: ${JSON.stringify((event.response as { error?: unknown }).error ?? {})}`)

      case 'response.incomplete':
        console.warn('[Grok] response incomplete:', JSON.stringify((event.response as { incomplete_details?: unknown }).incomplete_details ?? {}))
        break
    }
  }

  return text
}
