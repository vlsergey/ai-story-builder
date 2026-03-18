import type { AiSettings } from './ai-settings.js'

export interface YandexAiSettings extends Omit<AiSettings, 'webSearch'> {
  /** Web search intensity (Yandex-specific). 'none' disables web search. */
  webSearch?: 'none' | 'low' | 'medium' | 'high'
}