import z from "zod"
import type { AllAiEnginesConfig } from "./ai-engine-config.js"
import { AI_ENGINES_KEYS, type AiEngineKey } from "./ai-engines.js"
import { LOCALE_VALUES, type Locale } from "./locales.js"
import { THEME_PREFERENCE_VALUES, type ThemePreference } from "./themes.js"

export interface SettingDef<T> {
  dbKey: string
  schema: z.ZodSchema<T>
  defaultValue: T
}

const defineSetting = <T>(key: string, schema: z.ZodType<T>, defaultValue: T): SettingDef<T> =>
  ({ dbKey: key, defaultValue, schema }) as const satisfies SettingDef<T>

export const SettingsMap = {
  aiRegenerateGenerated: defineSetting<boolean>("ai_regenerate_generated", z.boolean(), false),
  aiRegenerateManual: defineSetting<boolean>("ai_regenerate_manual", z.boolean(), false),
  allAiEnginesConfig: defineSetting<AllAiEnginesConfig>("ai_config", z.any(), {}),
  currentBackend: defineSetting<AiEngineKey | null>("current_backend", z.enum(AI_ENGINES_KEYS).nullable(), null),
  autoGenerateSummary: defineSetting<boolean>("auto_generate_summary", z.boolean(), false),
  locale: defineSetting<Locale>("locale", z.enum(LOCALE_VALUES), "en"),
  layout: defineSetting<unknown>("layout", z.any(), {}),
  projectTitle: defineSetting<string | null>("project_title", z.string().nullable(), null),
  uiTheme: defineSetting<ThemePreference>("ui_theme", z.enum(THEME_PREFERENCE_VALUES), "auto"),
  verboseAiLogging: defineSetting<boolean>("verbose_ai_logging", z.boolean(), false),
} as const

export type SettingKey = keyof typeof SettingsMap

export type GetSettingType<K extends SettingKey> = (typeof SettingsMap)[K] extends SettingDef<infer T> ? T : never

export type SettingsTypes = {
  [K in keyof typeof SettingsMap]: GetSettingType<K>
}

export type BooleanSettingKey = {
  [K in SettingKey]: (typeof SettingsMap)[K] extends SettingDef<boolean> ? K : never
}[keyof typeof SettingsMap]

export const BOOLEAN_SETTING_KEYS = Object.entries(SettingsMap)
  .filter(([_, def]) => def.schema instanceof z.ZodBoolean)
  .map(([key]) => key) as BooleanSettingKey[]

export const DB_SETTING_KEY_TO_SETTING_KEY: Record<string, SettingKey> = Object.entries(SettingsMap).reduce(
  (acc, [key, def]) => {
    acc[def.dbKey] = key as SettingKey
    return acc
  },
  {} as Record<string, SettingKey>,
)
