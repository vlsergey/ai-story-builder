import OpenAI from 'openai'
import type { ResponseCreateParamsStreaming } from 'openai/resources/responses/responses.js'
import { makeLoggingFetch, isVerboseLogging } from './yandex-client.js'

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
  onThinking?: (status: string, detail?: string) => void,
  onDelta?: (text: string) => void,
): Promise<{ text: string; response_id?: string; tokensInput?: number; tokensOutput?: number; tokensTotal?: number; cachedTokens?: number; reasoningTokens?: number; costUsdTicks?: number }> {
  const client = createGrokClient(apiKey)

  const stream = await client.responses.create({
    ...params,
    stream: true,
  } as ResponseCreateParamsStreaming)

  let text = ''
  let responseId: string | undefined
  let tokensInput: number | undefined
  let tokensOutput: number | undefined
  let tokensTotal: number | undefined
  let cachedTokens: number | undefined
  let reasoningTokens: number | undefined
  let costUsdTicks: number | undefined

  for await (const event of stream) {
    if (isVerboseLogging()) {
      const { type, ...rest } = event as { type: string; [k: string]: unknown }
      console.log(`[Grok] SSE ${type} ${JSON.stringify(rest)}`)
    }

    switch (event.type) {
      case 'response.created': {
        const resp = (event as unknown as { response?: { id?: string } }).response
        if (resp?.id) responseId = resp.id
        break
      }

      case 'response.output_text.delta':
        text += event.delta
        onDelta?.(event.delta)
        break

      case 'response.reasoning_summary_text.delta': {
        const delta = (event as unknown as { delta?: string }).delta ?? ''
        if (delta) {
          console.log(`[Grok] reasoning delta: ${delta}`)
          onThinking?.('reasoning')
        }
        break
      }

      case 'response.reasoning_summary_text.done':
        if (event.text) {
          console.log(`[Grok] reasoning summary done:\n${event.text}`)
          onThinking?.('reasoning_done')
        }
        break

      case 'response.reasoning_text.delta': {
        const delta = (event as unknown as { delta?: string }).delta ?? ''
        if (delta) {
          console.log(`[Grok] reasoning text delta: ${delta}`)
          onThinking?.('reasoning')
        }
        break
      }

      case 'response.reasoning_text.done':
        if ((event as unknown as { text?: string }).text) {
          console.log(`[Grok] reasoning text done:\n${(event as unknown as { text: string }).text}`)
        }
        break

      case 'response.output_item.added': {
        const item = (event as unknown as { item?: { type?: string; name?: string } }).item
        if (item?.type === 'custom_tool_call') {
          console.log(`[Grok] custom tool call: ${item.name ?? 'unknown'}`)
          if (item.name === 'read_attachment') {
            onThinking?.('reading_attachment')
          }
        }
        break
      }

      case 'response.custom_tool_call_input.done': {
        const input = (event as unknown as { input?: string }).input
        if (input) {
          try {
            const parsed = JSON.parse(input) as { key?: string; query?: string }
            if (parsed.key) console.log(`[Grok] read_attachment key: ${parsed.key}`)
            if (parsed.query) {
              console.log(`[Grok] read_attachment query: ${parsed.query}`)
              onThinking?.('reading_attachment', parsed.query)
            }
          } catch { /* ignore */ }
        }
        break
      }

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

      case 'response.output_item.done': {
        const item = (event as unknown as { item?: { type?: string; action?: { query?: string } } }).item
        if (item?.type === 'web_search_call') {
          const query = item.action?.query
          console.log(`[Grok] web search done: ${query ?? '(no query)'}`)
          onThinking?.('web_search_completed', query)
        }
        break
      }

      case 'response.completed': {
        const usage = (event as unknown as { response?: { usage?: {
          input_tokens?: number
          output_tokens?: number
          total_tokens?: number
          cost_in_usd_ticks?: number
          input_tokens_details?: { cached_tokens?: number }
          output_tokens_details?: { reasoning_tokens?: number }
        } } }).response?.usage
        if (usage) {
          if (usage.input_tokens != null) tokensInput = usage.input_tokens
          if (usage.output_tokens != null) tokensOutput = usage.output_tokens
          if (usage.total_tokens != null) tokensTotal = usage.total_tokens
          if (usage.cost_in_usd_ticks != null) costUsdTicks = usage.cost_in_usd_ticks
          if (usage.input_tokens_details?.cached_tokens != null) cachedTokens = usage.input_tokens_details.cached_tokens
          if (usage.output_tokens_details?.reasoning_tokens != null) reasoningTokens = usage.output_tokens_details.reasoning_tokens
        }
        break
      }

      case 'response.failed':
        throw new Error(`Grok response failed: ${JSON.stringify((event.response as { error?: unknown }).error ?? {})}`)

      case 'response.incomplete':
        console.warn('[Grok] response incomplete:', JSON.stringify((event.response as { incomplete_details?: unknown }).incomplete_details ?? {}))
        break
    }
  }

  return { text, response_id: responseId, tokensInput, tokensOutput, tokensTotal, cachedTokens, reasoningTokens, costUsdTicks }
}
