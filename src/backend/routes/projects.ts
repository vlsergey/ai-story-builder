import fs from 'fs'
import path from 'path'
import type { ProjectInitialData } from '../types/index.js'
import {
  getCurrentDbPath,
  setCurrentDbPath,
  readAppSettings,
  writeAppSettings,
  getDataDir,
} from '../db/state.js'
import { setVerboseLogging } from '../lib/ai-logging.js'
import { sanitizeProjectName } from '../lib/project-name.js'
import { SettingsRepository } from '../settings/settings-repository.js'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

// Lazy loader — deferred so that test imports don't trigger the require
function openProjectDatabase(dbPath: string): import('better-sqlite3').Database {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../db/index.js') as {
    openProjectDatabase: (p: string) => import('better-sqlite3').Database
  }
  return mod.openProjectDatabase(dbPath)
}

// better-sqlite3 is optional
let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

function getProjectInitialData(dbPath: string): ProjectInitialData {
  // SettingsRepository uses the current project, which should already be set via setCurrentDbPath
  try {
    const layout = SettingsRepository.getLayout()
    const projectTitle = SettingsRepository.getProjectTitle()
    return { layout, projectTitle }
  } catch (e) {
    console.warn('[getProjectInitialData] failed to read initial data from', dbPath, (e as Error).message)
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
  const dbPath = getCurrentDbPath()
  return { isOpen: !!dbPath, path: dbPath }
}

export function closeProject(): { ok: boolean } {
  setCurrentDbPath(null)
  return { ok: true }
}

export function openProject(dbPath: string): { path: string; layout: unknown; projectTitle: string | null } {
  if (!dbPath) throw makeError('path required', 400)

  if (!fs.existsSync(dbPath)) {
    throw makeError('database file not found', 404)
  }

  try {
    const db = openProjectDatabase(dbPath) // runs any pending migrations
    // Auto-create root plan node if none exist
    const planCount = (db.prepare('SELECT COUNT(*) AS c FROM plan_nodes').get() as { c: number }).c
    if (planCount === 0) {
      const rootTitle = SettingsRepository.getProjectTitleWithDb(db) ?? 'Plan'
      db.prepare('INSERT INTO plan_nodes (parent_id, title, position) VALUES (NULL, ?, 0)').run(rootTitle)
    }
    db.close()
  } catch (e) {
    throw makeError('failed to open database: ' + String(e), 500)
  }

  setCurrentDbPath(dbPath)
  applyRuntimeSettings(dbPath)
  updateRecent(dbPath)
  return { path: dbPath, ...getProjectInitialData(dbPath) }
}

export function getRecentProjects(): string[] {
  const s = readAppSettings()
  return s.recent || []
}

export function deleteRecentProject(p: string): { ok: boolean } {
  if (!p) throw makeError('path required', 400)
  const s = readAppSettings()
  s.recent = (s.recent || []).filter((x) => x !== p)
  writeAppSettings(s)
  return { ok: true }
}

export function listProjectFiles(): { dir: string; files: string[] } {
  const projectsDir = path.join(getDataDir(), 'projects')
  if (!fs.existsSync(projectsDir)) return { dir: projectsDir, files: [] }
  const files = fs
    .readdirSync(projectsDir)
    .filter((f) => f.endsWith('.sqlite') || f.endsWith('.db'))
    .map((f) => path.join(projectsDir, f))
  return { dir: projectsDir, files }
}

export function openProjectFolder(): { ok: boolean } {
  const projectsDir = path.join(getDataDir(), 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  try {
    // In production, the backend runs inside Electron — use shell.openPath()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shell } = require('electron') as typeof import('electron')
    shell.openPath(projectsDir)
  } catch {
    // In dev, fall back to a platform-specific CLI command
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { exec } = require('child_process') as typeof import('child_process')
    const cmd =
      process.platform === 'win32'
        ? `explorer "${projectsDir}"`
        : process.platform === 'darwin'
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
  const text_language = data?.text_language ?? 'ru-RU'
  const safeName = sanitizeProjectName(name)
  const projectsDir = path.join(getDataDir(), 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const dbPath = path.join(projectsDir, `${safeName}.sqlite`)

  const defaultNodes = text_language.startsWith('ru')
    ? { root: 'Лор истории', children: ['Персонажи', 'Локации', 'Способности', 'Заклинания', 'Бестиарий', 'Задания'] }
    : { root: 'Story Lore',  children: ['Characters', 'Locations', 'Abilities', 'Spells', 'Bestiary', 'Quests'] }

  if (fs.existsSync(dbPath)) {
    try {
      const db = openProjectDatabase(dbPath) // runs migrations on any existing DB
      const hasRoot = db.prepare('SELECT id FROM lore_nodes WHERE parent_id IS NULL LIMIT 1').get()
      if (!hasRoot) {
        const insertNode = db.prepare('INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)')
        const root = insertNode.run(null, defaultNodes.root)
        const rootId = root.lastInsertRowid
        for (const f of defaultNodes.children) insertNode.run(rootId, f)
      }
      db.close()
    } catch (e) {
      throw makeError(String(e), 500)
    }
    setCurrentDbPath(dbPath)
    updateRecent(dbPath)
    return { path: dbPath, reused: true, ...getProjectInitialData(dbPath) }
  }

  try {
    const db: import('better-sqlite3').Database = openProjectDatabase(dbPath)

    const insertNode = db.prepare('INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)')
    const root = insertNode.run(null, defaultNodes.root)
    const rootId = root.lastInsertRowid
    for (const f of defaultNodes.children) insertNode.run(rootId, f)

    SettingsRepository.setProjectTitleWithDb(db, name)
    SettingsRepository.setWithDb(db, 'locale', 'en')
    SettingsRepository.setTextLanguageWithDb(db, text_language)

    db.prepare('INSERT INTO plan_nodes (parent_id, title, position) VALUES (NULL, ?, 0)').run(name)

    db.close()

    setCurrentDbPath(dbPath)
    updateRecent(dbPath)

    return { path: dbPath, layout: null, projectTitle: name }
  } catch (e) {
    throw makeError(String(e), 500)
  }
}
