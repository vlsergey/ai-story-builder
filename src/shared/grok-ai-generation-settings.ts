import type { AiGenerationSettings } from "./ai-generation-settings.js"

export interface GrokAiGenerationSettings extends AiGenerationSettings {
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  /** Search the web. */
  web_search?: boolean
  /** Search X. */
  x_search?: boolean
  /**
   * Amount of reasoning to do before producing output. Reasoning models only.
   * Valid values forwarded to xAI: "none" / "low" / "medium" / "high".
   * Undefined means "don't send reasoning_effort, let the model use its
   * built-in default" — that is NOT the same as "none" (which is an
   * explicit instruction to do no reasoning).
   */
  reasoning_effort?: "none" | "low" | "medium" | "high"
}
