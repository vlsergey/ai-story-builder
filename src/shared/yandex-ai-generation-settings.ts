import type { AiGenerationSettings } from "./ai-generation-settings.js"

export interface YandexAiGenerationSettings extends AiGenerationSettings {
  /**
   * Web search intensity. "none" disables web search; "low"/"medium"/"high"
   * map to the `search_context_size` parameter of the Responses-API
   * web_search tool. `undefined` (post-schema "default") leaves the tool
   * unattached so Yandex applies its own default behaviour.
   */
  webSearch?: "none" | "low" | "medium" | "high"
}
