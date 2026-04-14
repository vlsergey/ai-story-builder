import type { AiGenerationSettings } from "./ai-generation-settings.js"

export interface GrokAiGenerationSettings extends AiGenerationSettings {
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  /** Search the web. */
  web_search?: boolean
  /** Search X. */
  x_search?: boolean
}
