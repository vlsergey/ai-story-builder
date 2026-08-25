import type { AiGenerationSettings } from "./ai-generation-settings.js"

export interface OllamaAiGenerationSettings extends AiGenerationSettings {
  /** Upper bound on generated tokens. 0 / undefined means "let the model stop on its own". */
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  /**
   * Context window in tokens. Ollama silently truncates the prompt to the
   * model's default `num_ctx` (often 4096) regardless of what the model can
   * actually hold — a 38 KB prompt would lose its head without a word of
   * warning. Set this to the model's real window.
   */
  num_ctx?: number
  /**
   * Thinking models emit a separate reasoning channel. When false, the model
   * is asked to skip it; the field is ignored by models without the capability.
   */
  think?: boolean
}
