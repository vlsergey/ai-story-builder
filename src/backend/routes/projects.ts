import { exec } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import electron from "electron"
import { openProjectDatabase } from "../db/index.js"
import {
  getCurrentDbPath,
  getDataDir,
  isOpen,
  readAppSettings,
  setCurrentDbPath,
  writeAppSettings,
} from "../db/state.js"
import { setVerboseLogging } from "../lib/ai-logging.js"
import { sanitizeProjectName } from "../lib/project-name.js"
import { LoreNodeRepository } from "../lore/lore-node-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import type { ProjectInitialData } from "../types/index.js"

const { shell } = electron

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

function getProjectInitialData(dbPath: string): ProjectInitialData {
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

/** Reads runtime flags (e.g. verbose_ai_logging) from the project DB and applies them. */
export function applyRuntimeSettings(dbPath: string): void {
  try {
    const verbose = SettingsRepository.getVerboseAiLogging()
    setVerboseLogging(verbose)
  } catch {
    // non-fatal — leave current flag value unchanged
  }
}

function updateRecent(dbPath: string): void {
  const s = readAppSettings()
  s.recent = s.recent || []
  s.recent = [dbPath].concat(s.recent.filter((x) => x !== dbPath)).slice(0, 10)
  writeAppSettings(s)
}

export function getProjectStatus(): { isOpen: boolean; path: string | null } {
  return { isOpen: isOpen(), path: getCurrentDbPath() }
}

export function closeProject(): { ok: boolean } {
  setCurrentDbPath(null)
  return { ok: true }
}

export function openProject(dbPath: string): { path: string; layout: unknown; projectTitle: string | null } {
  if (!dbPath) throw makeError("path required", 400)

  if (!fs.existsSync(dbPath)) {
    throw makeError("database file not found", 404)
  }

  try {
    const db = openProjectDatabase(dbPath) // runs any pending migrations
    db.close() // close the migration connection

    // Now set the current project so repositories can work
    setCurrentDbPath(dbPath)

    // Auto-create root plan node if none exist
    const planRepo = new PlanNodeRepository()
    const planCount = planRepo.count()
    if (planCount === 0) {
      const rootTitle = SettingsRepository.getProjectTitle() ?? "Plan"
      planRepo.insert({ title: rootTitle, parent_id: null, position: 0 })
    }
  } catch (e) {
    console.error(e)
    throw makeError(`failed to open database: ${String(e)}`, 500)
  }

  applyRuntimeSettings(dbPath)
  updateRecent(dbPath)
  return { path: dbPath, ...getProjectInitialData(dbPath) }
}

export function getRecentProjects(): string[] {
  const s = readAppSettings()
  return s.recent || []
}

export function deleteRecentProject(p: string): { ok: boolean } {
  if (!p) throw makeError("path required", 400)
  const s = readAppSettings()
  s.recent = (s.recent || []).filter((x) => x !== p)
  writeAppSettings(s)
  return { ok: true }
}

export function listProjectFiles(): { dir: string; files: string[] } {
  const projectsDir = path.join(getDataDir(), "projects")
  if (!fs.existsSync(projectsDir)) return { dir: projectsDir, files: [] }
  const files = fs
    .readdirSync(projectsDir)
    .filter((f) => f.endsWith(".sqlite") || f.endsWith(".db"))
    .map((f) => path.join(projectsDir, f))
  return { dir: projectsDir, files }
}

export function openProjectFolder(): { ok: boolean } {
  const projectsDir = path.join(getDataDir(), "projects")
  fs.mkdirSync(projectsDir, { recursive: true })
  try {
    // In production, the backend runs inside Electron — use shell.openPath()
    shell.openPath(projectsDir)
  } catch {
    // In dev, fall back to a platform-specific CLI command
    const cmd =
      process.platform === "win32"
        ? `explorer "${projectsDir}"`
        : process.platform === "darwin"
          ? `open "${projectsDir}"`
          : `xdg-open "${projectsDir}"`
    exec(cmd)
  }
  return { ok: true }
}

export function createProject(data: { name?: string; text_language?: string }): {
  path: string
  layout: unknown
  projectTitle: string | null
  reused?: boolean
} {
  const name = data?.name ? data.name : `project-${Date.now()}`
  const text_language = data?.text_language ?? "ru-RU"
  const safeName = sanitizeProjectName(name)
  const projectsDir = path.join(getDataDir(), "projects")
  fs.mkdirSync(projectsDir, { recursive: true })
  const dbPath = path.join(projectsDir, `${safeName}.sqlite`)

  const defaultNodes = text_language.startsWith("ru")
    ? { root: "Лор истории", children: ["Персонажи", "Локации", "Способности", "Заклинания", "Бестиарий", "Задания"] }
    : { root: "Story Lore", children: ["Characters", "Locations", "Abilities", "Spells", "Bestiary", "Quests"] }

  if (fs.existsSync(dbPath)) {
    try {
      // Ensure the project is set as current for repositories
      setCurrentDbPath(dbPath)
      const loreRepo = new LoreNodeRepository()
      const rootNodes = loreRepo.findAll().filter((n) => n.parent_id === null)
      if (rootNodes.length === 0) {
        const rootId = loreRepo.insert({ parent_id: null, title: defaultNodes.root })
        for (const childTitle of defaultNodes.children) {
          loreRepo.insert({ parent_id: rootId, title: childTitle })
        }
      }
    } catch (e) {
      throw makeError(String(e), 500)
    }
    setCurrentDbPath(dbPath)
    updateRecent(dbPath)
    return { path: dbPath, reused: true, ...getProjectInitialData(dbPath) }
  }

  try {
    const db = openProjectDatabase(dbPath)

    // Create default lore nodes using repository
    setCurrentDbPath(dbPath) // temporary for repositories
    const loreRepo = new LoreNodeRepository()
    const root = loreRepo.insert({ parent_id: null, title: defaultNodes.root })
    for (const childTitle of defaultNodes.children) {
      loreRepo.insert({ parent_id: root, title: childTitle })
    }

    SettingsRepository.setProjectTitle(name)
    SettingsRepository.set("locale", "en")
    SettingsRepository.setTextLanguage(text_language)

    const planRepo = new PlanNodeRepository()
    planRepo.insert({ parent_id: null, title: name, position: 0 })

    db.close()

    setCurrentDbPath(dbPath)
    updateRecent(dbPath)

    return { path: dbPath, layout: null, projectTitle: name }
  } catch (e) {
    throw makeError(String(e), 500)
  }
}
