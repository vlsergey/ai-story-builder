import type { AllAiEnginesConfig } from "@shared/ai-engine-config"
import { THEME_PREFERENCE_VALUES } from "@shared/themes"
import z from "zod"
import type { RouteBuilder } from "../router"
import { refreshEngineModels, setCurrentEngine } from "../routes/ai-config"
import { SettingsRepository } from "./settings-repository"

export function settingsRoutes(t: RouteBuilder) {
  return t.router({
    get: t.procedure.input(z.string()).query(({ input }) => SettingsRepository.get(input)),
    set: t.procedure
      .input(z.tuple([z.string(), z.any()]))
      .mutation(({ input }) => SettingsRepository.set(input[0], input[1])),

    autoGenerateSummary: t.router({
      get: t.procedure.query(() => SettingsRepository.getAutoGenerateSummary()),
      set: t.procedure.input(z.boolean()).mutation(({ input }) => SettingsRepository.setAutoGenerateSummary(input)),
    }),

    layout: t.router({
      get: t.procedure.query(() => SettingsRepository.getLayout()),
      set: t.procedure.input(z.unknown()).mutation(({ input }) => SettingsRepository.saveLayout(input)),
    }),

    textLanguage: t.router({
      get: t.procedure.query(() => SettingsRepository.getTextLanguage()),
      set: t.procedure.input(z.string()).mutation(({ input }) => SettingsRepository.setTextLanguage(input)),
    }),

    uiTheme: t.router({
      get: t.procedure.query(() => SettingsRepository.getUiTheme()),
      set: t.procedure
        .input(z.enum(THEME_PREFERENCE_VALUES))
        .mutation(({ input }) => SettingsRepository.setUiTheme(input)),
    }),

    verboseAiLogging: t.router({
      get: t.procedure.query(() => SettingsRepository.getVerboseAiLogging()),
      set: t.procedure.input(z.boolean()).mutation(({ input }) => SettingsRepository.setVerboseAiLogging(input)),
    }),

    allAiEnginesConfig: t.router({
      get: t.procedure.query(() => SettingsRepository.getAllAiEnginesConfig()),
      set: t.procedure
        .input((v) => v as AllAiEnginesConfig)
        .mutation(({ input }) => SettingsRepository.saveAllAiEnginesConfig(input)),
      currentEngine: t.router({
        get: t.procedure.query(() => SettingsRepository.getCurrentBackend()),
        set: t.procedure.input(z.string().nullable()).mutation(({ input }) => setCurrentEngine(input)),
        availableModels: t.router({
          get: t.procedure.query(() => SettingsRepository.getCurrentEngineAvailableModels()),
        }),
        defaultAiGenerationSettings: t.router({
          get: t.procedure.query(() => SettingsRepository.getCurrentEngineDefaultAiGenerationSettings()),
        }),
        summaryAiGenerationSettings: t.router({
          get: t.procedure.query(() => SettingsRepository.getCurrentEngineSummaryAiGenerationSettings()),
        }),
      }),
      refreshEngineModels: t.procedure.input(z.string()).mutation(({ input }) => refreshEngineModels(input)),
    }),
  })
}
