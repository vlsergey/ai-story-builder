import type { AiGenerationSettings } from "./ai-generation-settings.js"

export interface YandexAiGenerationSettings extends AiGenerationSettings {
  /** Upper bound on output tokens, sent to Yandex as `max_output_tokens`. Absent: provider default. */
  max_completion_tokens?: number
  /**
   * Web search intensity. "none" disables web search; "low"/"medium"/"high"
   * map to the `search_context_size` parameter of the Responses-API
   * web_search tool. `undefined` (post-schema "default") leaves the tool
   * unattached so Yandex applies its own default behaviour.
   */
  webSearch?: "none" | "low" | "medium" | "high"
}
