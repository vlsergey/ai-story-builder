import type { AiGenerationSettings } from './ai-generation-settings.js'

export interface GrokAiGenerationSettings extends AiGenerationSettings {
  max_output_tokens?: number,
  temperature?: number,
  top_p?: number,
  webSearch?: boolean,
}
