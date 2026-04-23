import z from "zod"
import type { AllAiEnginesConfig } from "../../shared/ai-engine-config.js"
import { AI_ENGINES_KEYS } from "../../shared/ai-engines.js"
import { type SettingDef, type SettingKey, SettingsMap, type SettingsTypes } from "../../shared/settings.js"
import type { RouteBuilder } from "../router.js"
import { refreshEngineModels, setCurrentEngine } from "../routes/ai-config.js"
import {
  getCurrentEngineAvailableModels,
  getCurrentEngineDefaultAiGenerationSettings,
  getCurrentEngineSummaryAiGenerationSettings,
} from "./ai-settings.js"
import { SettingsRepository } from "./settings-repository.js"

function buildSettingRouter<K extends SettingKey>(t: RouteBuilder, key: K) {
  const def = SettingsMap[key] as SettingDef<SettingsTypes[K]>
  return t.router({
    get: t.procedure.query(() => SettingsRepository.get(def)),
    set: t.procedure
      .input((val: unknown): SettingsTypes[K] => {
        console.info("buildSettingRouter", "set", "input", val)
        if (val === undefined && def.schema instanceof z.ZodBoolean) {
          // falsy bug workaround
          val = false
        }
        return def.schema.parse(val)
      })
      .mutation(({ input }) => SettingsRepository.set(def, input as SettingsTypes[K])),
    subscribe: t.procedure.subscription(() => SettingsRepository.subscribeToSingle(key)),
  })
}

export function settingsRoutes(t: RouteBuilder) {
  return t.router({
    aiRegenerateGenerated: buildSettingRouter(t, "aiRegenerateGenerated"),
    aiRegenerateManual: buildSettingRouter(t, "aiRegenerateManual"),
    autoGenerateSummary: buildSettingRouter(t, "autoGenerateSummary"),
    layout: buildSettingRouter(t, "layout"),
    locale: buildSettingRouter(t, "locale"),
    uiTheme: buildSettingRouter(t, "uiTheme"),
    verboseAiLogging: buildSettingRouter(t, "verboseAiLogging"),
    allAiEnginesConfig: t.router({
      get: t.procedure.query(() => SettingsRepository.getAllAiEnginesConfig()),
      set: t.procedure
        .input((v) => v as AllAiEnginesConfig)
        .mutation(({ input }) => SettingsRepository.setAllAiEnginesConfig(input)),
      currentEngine: t.router({
        get: t.procedure.query(() => SettingsRepository.getCurrentBackend()),
        set: t.procedure.input(z.enum(AI_ENGINES_KEYS).nullable()).mutation(({ input }) => setCurrentEngine(input)),
        availableModels: t.router({
          get: t.procedure.query(() => getCurrentEngineAvailableModels()),
        }),
        defaultAiGenerationSettings: t.router({
          get: t.procedure.query(() => getCurrentEngineDefaultAiGenerationSettings()),
        }),
        summaryAiGenerationSettings: t.router({
          get: t.procedure.query(() => getCurrentEngineSummaryAiGenerationSettings()),
        }),
      }),
      refreshEngineModels: t.procedure
        .input(z.enum(AI_ENGINES_KEYS))
        .mutation(({ input }) => refreshEngineModels(input)),
    }),
    subscribe: t.procedure.subscription(() => SettingsRepository.subscribeToAll()),
  })
}
