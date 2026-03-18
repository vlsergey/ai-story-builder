import type { AiSettings } from './ai-settings.js'

export interface GrokAiSettings extends Omit<AiSettings, 'webSearch'> {
  /** Whether to enable web search (Grok-specific). */
  webSearch?: boolean
}