import type { AiEngineDefinition } from '../../shared/ai-engines.js'

export interface JsonSchemaSpec {
  /** Identifier used in the API call (no spaces, e.g. "lore_node") */
  name: string
  description?: string
  /** Full JSON Schema object (type:"object", properties, required, additionalProperties:false) */
  schema: Record<string, unknown>
}

export interface AiConfigStore {
  yandex?: { api_key?: string; folder_id?: string; search_index_id?: string }
  grok?: { api_key?: string }
  [key: string]: unknown
}

export interface GenerateResponseRequest {
  prompt: string
  systemPrompt: string
  /** Requested model ID, or empty string to use the engine default. */
  model: string
  includeExistingLore: boolean
  webSearch: string
  /** Uploaded file IDs for the active engine (already filtered by to_be_deleted). */
  engineFileIds: string[]
  engineDef: AiEngineDefinition
  config: AiConfigStore
  /** When provided, adapters request structured JSON output; route emits partial_json SSE events. */
  responseSchema?: JsonSchemaSpec
}

/**
 * Engine-agnostic adapter interface. One implementation per AI provider.
 * New operations (e.g. rewriteChapter, summarise) are added as additional
 * methods here rather than creating separate per-operation adapter files.
 *
 * generateResponse() owns the full SSE lifecycle:
 *   onThinking('generating') → ... → onDelta(chunk) → ... → onThinking('done')
 * The route calls sse('done', {}) + res.end() after this resolves.
 * Throws on unrecoverable errors (the route will emit sse('error', ...)).
 */
export interface AiEngineAdapter {
  generateResponse(
    req: GenerateResponseRequest,
    onThinking: (status: string, detail?: string) => void,
    onDelta: (text: string) => void,
  ): Promise<{ response_id?: string }>
}

import { GrokAdapter } from './grok-adapter.js'
import { YandexAdapter } from './yandex-adapter.js'

/** Returns the adapter for the given engine ID, or null if unsupported. */
export function getEngineAdapter(engineId: string): AiEngineAdapter | null {
  if (engineId === 'grok') return new GrokAdapter()
  if (engineId === 'yandex') return new YandexAdapter()
  return null
}
