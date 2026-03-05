import type { AiEngineDefinition } from '../../shared/ai-engines.js'

export interface AiConfigStore {
  yandex?: { api_key?: string; folder_id?: string; search_index_id?: string }
  grok?: { api_key?: string }
  [key: string]: unknown
}

export interface LoreGenerateRequest {
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
}

/**
 * Engine-agnostic interface for lore generation.
 * Each engine adapter implements this and owns the full SSE lifecycle:
 *   onThinking('generating') → ... → onDelta(chunk) → ... → onThinking('done')
 * The route calls sse('done', {}) + res.end() after this resolves.
 * Throws on unrecoverable errors (the route will emit sse('error', ...)).
 */
export interface LoreGenerateAdapter {
  generateLore(
    req: LoreGenerateRequest,
    onThinking: (status: string) => void,
    onDelta: (text: string) => void,
  ): Promise<void>
}

import { GrokLoreAdapter } from './grok-adapter.js'
import { YandexLoreAdapter } from './yandex-adapter.js'

/** Returns the adapter for the given engine ID, or null if unsupported. */
export function getLoreAdapter(engineId: string): LoreGenerateAdapter | null {
  if (engineId === 'grok') return new GrokLoreAdapter()
  if (engineId === 'yandex') return new YandexLoreAdapter()
  return null
}
