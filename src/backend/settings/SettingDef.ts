import type { AllAiEnginesConfig } from "@shared/ai-engine-config.js"
import { AI_ENGINES_KEYS, type AiEngineKey } from "@shared/ai-engines.js"
import { LOCALE_VALUES, type Locale } from "@shared/locales.js"
import { THEME_PREFERENCE_VALUES, type ThemePreference } from "@shared/themes.js"
import z from "zod"

export interface SettingDef<T> {
  key: string
  schema: z.ZodSchema<T>
  defaultValue: T
}

const defineSetting = <T>(key: string, schema: z.ZodType<T>, defaultValue: T): SettingDef<T> =>
  ({ key, defaultValue, schema }) as const satisfies SettingDef<T>

export const AI_CONFIG = defineSetting<AllAiEnginesConfig>("ai_config", z.any(), {})

export const AI_CURRENT_ENGINE = defineSetting<AiEngineKey | null>(
  "current_backend",
  z.enum(AI_ENGINES_KEYS).nullable(),
  null,
)

export const AUTO_GENERATE_SUMMARY = defineSetting("auto_generate_summary", z.boolean(), false)

export const LOCALE = defineSetting<Locale>("locale", z.enum(LOCALE_VALUES), "en")

export const LAYOUT = defineSetting<unknown>("layout", z.any(), {})

export const PROJECT_TITLE = defineSetting("project_title", z.string().nullable(), null)

export const UI_THEME = defineSetting<ThemePreference>("ui_theme", z.enum(THEME_PREFERENCE_VALUES), "auto")

export const VERBOSE_AI_LOGGING = defineSetting("verbose_ai_logging", z.boolean(), false)

export const SettingsMap = {
  allAiEnginesConfig: AI_CONFIG,
  currentBackend: AI_CURRENT_ENGINE,
  autoGenerateSummary: AUTO_GENERATE_SUMMARY,
  locale: LOCALE,
  layout: LAYOUT,
  projectTitle: PROJECT_TITLE,
  uiTheme: UI_THEME,
  verboseAiLogging: VERBOSE_AI_LOGGING,
} as const
