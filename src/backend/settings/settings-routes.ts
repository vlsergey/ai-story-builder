import type { AllAiEnginesConfig } from "@shared/ai-engine-config"
import { AI_ENGINES_KEYS } from "@shared/ai-engines"
import z from "zod"
import type { RouteBuilder } from "../router"
import { refreshEngineModels, setCurrentEngine } from "../routes/ai-config"
import {
  getCurrentEngineAvailableModels,
  getCurrentEngineDefaultAiGenerationSettings,
  getCurrentEngineSummaryAiGenerationSettings,
} from "./ai-settings"
import { AUTO_GENERATE_SUMMARY, LAYOUT, type SettingDef, UI_THEME, VERBOSE_AI_LOGGING } from "./SettingDef"
import { SettingsRepository } from "./settings-repository"

function buildSettingRouter<T>(t: RouteBuilder, def: SettingDef<T>) {
  return t.router({
    get: t.procedure.query(() => SettingsRepository.get(def)),
    set: t.procedure.input(def.schema).mutation(({ input }) => SettingsRepository.set(def, input as T)),
  })
}

export function settingsRoutes(t: RouteBuilder) {
  return t.router({
    autoGenerateSummary: buildSettingRouter(t, AUTO_GENERATE_SUMMARY),
    layout: buildSettingRouter(t, LAYOUT),
    uiTheme: buildSettingRouter(t, UI_THEME),
    verboseAiLogging: buildSettingRouter(t, VERBOSE_AI_LOGGING),
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
  })
}
