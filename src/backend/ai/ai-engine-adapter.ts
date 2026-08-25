import type { AiEngineConfig } from "@shared/ai-engine-config.js"
import type OpenAI from "openai"
import type { AiEngineKey } from "../../shared/ai-engines.js"
import type { AiGenerationSettings } from "../../shared/ai-generation-settings.js"
import { GrokAdapter } from "./grok-adapter.js"
import { OllamaAdapter } from "./ollama-adapter.js"
import { YandexAdapter } from "./yandex-adapter.js"

export interface JsonSchemaSpec {
  /** Identifier used in the API call (no spaces, e.g. "lore_node") */
  name: string
  description?: string
  /** Full JSON Schema object (type:"object", properties, required, additionalProperties:false) */
  schema: Record<string, unknown>
}

export interface GenerateResponseRequest<S extends AiGenerationSettings = AiGenerationSettings> {
  abortSignal: AbortSignal
  userPrompt: string | null
  systemPrompt: string | null
  /** Whether to include existing lore files as attachments. */
  includeExistingLore: boolean
  /** Uploaded file IDs for the active engine (already filtered by to_be_deleted). */
  engineFileIds: string[]
  /** AI settings specific to the engine (model, webSearch, maxTokens, etc.), including settings from current node or UI */
  aiGenerationSettings?: S
  /**
   * Per-call engine config override. When set, the adapter reads `api_key`,
   * `defaultAiGenerationSettings`, `folder_id`, etc. from this object instead
   * of calling `SettingsRepository`. Required for any call site that runs
   * without an open project sqlite (wizard-time advice, etc.).
   */
  engineConfig?: AiEngineConfig<S>
  /** Routing keys (to increase cache hit) */
  promptCacheKeys: string[]
  /** When provided, adapters request structured JSON output; route emits partial_json SSE events. */
  responseSchema?: JsonSchemaSpec
  /**
   * When true (default), adapters apply API-level JSON schema enforcement
   * (text.format for Grok, response_format for Yandex).
   * When false, the schema is provided only via the system prompt and the
   * raw text response is parsed as JSON by the route (useful for complex
   * schemas where strict enforcement may be unreliable).
   */
  stringFormat?: boolean
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
export interface AiEngineAdapter<T extends AiGenerationSettings = AiGenerationSettings> {
  generateResponse(
    req: GenerateResponseRequest<T>,
    onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
  ): Promise<string>

  testConnectivity(settings: AiEngineConfig<T>): Promise<{ ok: boolean; detail?: string; error?: string }>
}

const adapters = {
  grok: new GrokAdapter(),
  yandex: new YandexAdapter(),
  ollama: new OllamaAdapter(),
} as const

export function getEngineAdapter(engineId: AiEngineKey): AiEngineAdapter<AiGenerationSettings> {
  return adapters[engineId]
}
