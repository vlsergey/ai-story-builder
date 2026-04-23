import * as z from "zod"
import type { AiEngineDefinition } from "./ai-engines.js"
import { type AiGenerationSettings, getAiGenerationSettingsSchema } from "./ai-generation-settings.js"
import type { GrokAiGenerationSettings } from "./grok-ai-generation-settings.js"
import type { YandexAiGenerationSettings } from "./yandex-ai-generation-settings.js"

export interface AllAiEnginesConfig {
  grok?: GrokEngineConfig
  yandex?: YandexEngineConfig
}

export interface AiEngineConfig<EngineAiGenerationSettings extends AiGenerationSettings = AiGenerationSettings> {
  api_key?: string
  available_models?: string[]
  defaultAiGenerationSettings?: EngineAiGenerationSettings
  summaryAiGenerationSettings?: EngineAiGenerationSettings
  generateSummaryInstructions?: string
  [propName: string]: any
}

export const getAiEngineConfigSchema = (engineDef: AiEngineDefinition) =>
  z.object({
    api_key: z.string().optional(),
    available_models: z.array(z.string()).optional(),
    defaultAiGenerationSettings: getAiGenerationSettingsSchema(engineDef).optional(),
    summaryAiGenerationSettings: getAiGenerationSettingsSchema(engineDef).optional(),
    generateSummaryInstructions: z.string().optional(),
    ...Object.fromEntries(
      (engineDef?.configFields || []).map((field) =>
        field.schema ? [field.key, field.schema.optional()] : [field.key, z.string().optional()],
      ),
    ),
  })

export interface GrokEngineConfig extends AiEngineConfig<GrokAiGenerationSettings> {
  management_key?: string
  team_id?: string
}

export interface YandexEngineConfig extends AiEngineConfig<YandexAiGenerationSettings> {
  folder_id?: string
  search_index_id?: string
}
