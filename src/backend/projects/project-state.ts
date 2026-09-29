import fs from "node:fs"
import { openProjectDatabase } from "../db/index.js"
import { getCurrentDbPath, isOpen, setCurrentDbPath } from "../db/state.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { PlanNodeService } from "../plan/nodes/plan-node-service.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import type { ProjectInitialData } from "../types/index.js"
import { applyRuntimeSettings } from "./project-settings.js"
import { updateRecent } from "./recent-projects.js"

export function getProjectInitialData(dbPath: string): ProjectInitialData {
  // SettingsRepository uses the current project, which should already be set via setCurrentDbPath
  try {
    const layout = SettingsRepository.getLayout()
    const projectTitle = SettingsRepository.getProjectTitle()
    return { layout, projectTitle }
  } catch (e) {
    console.warn("[getProjectInitialData] failed to read initial data from", dbPath, (e as Error).message)
    return { layout: null, projectTitle: null }
  }
}

export function getProjectStatus(): { isOpen: boolean; path: string | null } {
  return { isOpen: isOpen(), path: getCurrentDbPath() }
}

export function closeProject(): { ok: boolean } {
  setCurrentDbPath(null)
  return { ok: true }
}

export function openProject(dbPath: string): { path: string; layout: unknown; projectTitle: string | null } {
  if (!dbPath) throw makeErrorWithStatus("path required", 400)

  if (!fs.existsSync(dbPath)) {
    throw makeErrorWithStatus("database file not found", 404)
  }

  try {
    const db = openProjectDatabase(dbPath) // runs any pending migrations
    db.close() // close the migration connection

    // Now set the current project so repositories can work
    setCurrentDbPath(dbPath)

    // Auto-create root plan node if none exist
    const planService = new PlanNodeService()
    // No run is going on while a project opens: what says it is was cut off.
    const interrupted = planService.states.resetInterrupted()
    if (interrupted > 0)
      console.info(`[project] ${interrupted} node(s) left GENERATING by an unfinished run are pending`)
    if (planService.count() === 0) {
      const rootTitle = SettingsRepository.getProjectTitle() ?? "Plan"
      planService.create({ title: rootTitle, parent_id: null, position: 0 })
    }
  } catch (e) {
    console.error(e)
    throw makeErrorWithStatus(`failed to open database: ${String(e)}`, 500)
  }

  applyRuntimeSettings(dbPath)
  updateRecent(dbPath)
  return { path: dbPath, ...getProjectInitialData(dbPath) }
}
