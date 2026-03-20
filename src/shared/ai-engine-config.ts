import type { AiGenerationSettings } from './ai-generation-settings.js'
import type { GrokAiGenerationSettings } from './grok-ai-generation-settings.js'
import type { YandexAiGenerationSettings } from './yandex-ai-generation-settings.js'
import type { AiEngineKey } from './ai-engines.js'

export interface AiConfigStore {
  'grok'?: GrokEngineConfig
  'yandex'?: YandexEngineConfig
  [key: AiEngineKey]: AiEngineConfig | undefined
}

export interface AiEngineConfig<EngineAiGenerationSettings extends AiGenerationSettings = AiGenerationSettings> {
  api_key?: string
  available_models?: string[]
  defaultAiGenerationSettings?: EngineAiGenerationSettings,
  summaryAiGenerationSettings?: EngineAiGenerationSettings,
  [propName: string]: any
}

export interface GrokEngineConfig extends AiEngineConfig<GrokAiGenerationSettings> {
  management_key?: string
  team_id?: string
}

export interface YandexEngineConfig extends AiEngineConfig<YandexAiGenerationSettings> {
  folder_id?: string
  search_index_id?: string
}
