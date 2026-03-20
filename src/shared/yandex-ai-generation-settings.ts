import type { AiGenerationSettings } from './ai-generation-settings.js'

export interface YandexAiGenerationSettings extends AiGenerationSettings {
  /** Web search intensity (Yandex-specific). 'none' disables web search. */
  webSearch?: 'none' | 'low' | 'medium' | 'high'
}
