import type { SettingsTypes } from "../../shared/settings.js"
import { setVerboseLogging } from "../ai/ai-logging.js"
import { isOpen } from "../db/state.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { closeProject, openProject } from "./project-state.js"

/** Reads runtime flags (e.g. verbose_ai_logging) from the project DB and applies them. */
export function applyRuntimeSettings(dbPath: string): void {
  try {
    const verbose = SettingsRepository.getVerboseAiLogging()
    setVerboseLogging(verbose)
  } catch {
    // non-fatal — leave current flag value unchanged
  }
}

/**
 * Opens a project by filename, loads all its settings, and returns them.
 * Ensures the project is closed afterwards (in a finally block).
 * Throws an error if a project is already open.
 */
export function getProjectSettings(filename: string): SettingsTypes {
  if (isOpen()) {
    throw makeErrorWithStatus("A project is already open", 400)
  }

  try {
    // Open the project
    openProject(filename)

    // Load all settings
    return SettingsRepository.getAll()
  } finally {
    // Ensure project is closed
    closeProject()
  }
}

/**
 * Applies settings to the currently open project.
 * Throws an error if no project is open.
 */
export function applyProjectSettings(settings: Partial<SettingsTypes>): { ok: boolean } {
  if (!isOpen()) {
    throw makeErrorWithStatus("No project is open", 400)
  }

  // Apply each setting if it's provided in the settings object
  if (settings.aiRegenerateGenerated !== undefined) {
    SettingsRepository.setAiRegenerateGenerated(settings.aiRegenerateGenerated)
  }
  if (settings.aiRegenerateManual !== undefined) {
    SettingsRepository.setAiRegenerateManual(settings.aiRegenerateManual)
  }
  if (settings.allAiEnginesConfig !== undefined) {
    SettingsRepository.setAllAiEnginesConfig(settings.allAiEnginesConfig)
  }
  if (settings.appliedTemplateFile !== undefined) {
    SettingsRepository.setAppliedTemplateFile(settings.appliedTemplateFile)
  }
  if (settings.currentBackend !== undefined) {
    SettingsRepository.setCurrentBackend(settings.currentBackend)
  }
  if (settings.autoGenerateSummary !== undefined) {
    SettingsRepository.setAutoGenerateSummary(settings.autoGenerateSummary)
  }
  if (settings.locale !== undefined) {
    SettingsRepository.setLocale(settings.locale)
  }
  if (settings.layout !== undefined) {
    SettingsRepository.setLayout(settings.layout)
  }
  if (settings.projectTitle !== undefined) {
    SettingsRepository.setProjectTitle(settings.projectTitle)
  }
  if (settings.uiTheme !== undefined) {
    SettingsRepository.setUiTheme(settings.uiTheme)
  }
  if (settings.verboseAiLogging !== undefined) {
    SettingsRepository.setVerboseAiLogging(settings.verboseAiLogging)
    // Also apply runtime logging setting immediately
    setVerboseLogging(settings.verboseAiLogging)
  }

  return { ok: true }
}
