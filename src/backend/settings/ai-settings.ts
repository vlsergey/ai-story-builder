import type { AiEngineConfig } from "@shared/ai-engine-config"
import type { AiGenerationSettings } from "@shared/ai-generation-settings"
import { SettingsRepository } from "./settings-repository.js"

export function getCurrentEngineConfig(): AiEngineConfig {
  const engine = SettingsRepository.getCurrentBackend()
  if (!engine) return {}
  return SettingsRepository.getAllAiEnginesConfig()[engine] ?? {}
}

export function getCurrentEngineAvailableModels(): string[] {
  return getCurrentEngineConfig().available_models ?? []
}

export function getCurrentEngineDefaultAiGenerationSettings(): AiGenerationSettings {
  return getCurrentEngineConfig().defaultAiGenerationSettings ?? {}
}

export function getCurrentEngineSummaryAiGenerationSettings(): AiGenerationSettings {
  return getCurrentEngineConfig().summaryAiGenerationSettings ?? {}
}

export function getCurrentEngineGenerateSummaryInstructions(): string | undefined {
  return getCurrentEngineConfig().generateSummaryInstructions
}

export function getDefaultAiSettings(): AiGenerationSettings {
  return getCurrentEngineConfig()?.defaultAiSettings ?? {}
}
