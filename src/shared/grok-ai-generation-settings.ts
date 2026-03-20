import type { AiGenerationSettings } from './ai-generation-settings.js'

export interface GrokAiGenerationSettings extends AiGenerationSettings {
  /** Whether to enable web search (Grok-specific). */
  webSearch?: boolean
}