import express, { Request, Response, Router } from 'express'
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
import { setVerboseLogging } from '../lib/yandex-client.js'
import { sanitizeProjectName } from '../lib/project-name.js'

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
  if (!Database) return { layout: null, projectTitle: null }
  try {
    const db = new Database(dbPath, { readonly: true })
    const layoutRow = db
      .prepare("SELECT value FROM settings WHERE key = 'layout'")
      .get() as { value: string } | undefined
    const titleRow = db
      .prepare("SELECT value FROM settings WHERE key = 'project_title'")
      .get() as { value: string } | undefined
    db.close()
    let layout: unknown = null
    if (layoutRow) {
      try {
        layout = JSON.parse(layoutRow.value)
      } catch (_) {}
    }
    return { layout, projectTitle: titleRow ? titleRow.value : null }
  } catch (e) {
    console.warn('[getProjectInitialData] failed to read initial data from', dbPath, (e as Error).message)
    return { layout: null, projectTitle: null }
  }
}

/** Reads runtime flags (e.g. verbose_ai_logging) from the project DB and applies them. */
export function applyRuntimeSettings(dbPath: string): void {
  if (!Database) return
  try {
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'verbose_ai_logging'")
      .get() as { value: string } | undefined
    db.close()
    setVerboseLogging(row?.value === 'true')
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

const router: Router = express.Router()

// GET /project/status
router.get('/status', (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  res.json({ isOpen: !!dbPath, path: dbPath })
})

// POST /project/close
router.post('/close', (_req: Request, res: Response) => {
  setCurrentDbPath(null)
  res.json({ ok: true })
})

// POST /project/open
router.post('/open', express.json(), (req: Request, res: Response) => {
  const { path: dbPath } = req.body as { path?: string }
  if (!dbPath) return res.status(400).json({ error: 'path required' })

  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'database file not found' })
  }

  try {
    const db = openProjectDatabase(dbPath) // runs any pending migrations
    // Auto-create root plan node if none exist
    const planCount = (db.prepare('SELECT COUNT(*) AS c FROM plan_nodes').get() as { c: number }).c
    if (planCount === 0) {
      const titleRow = db
        .prepare("SELECT value FROM settings WHERE key = 'project_title'")
        .get() as { value: string } | undefined
      const rootTitle = titleRow?.value ?? 'Plan'
      db.prepare('INSERT INTO plan_nodes (parent_id, title, position) VALUES (NULL, ?, 0)').run(rootTitle)
    }
    db.close()
  } catch (e) {
    return res.status(500).json({ error: 'failed to open database: ' + String(e) })
  }

  setCurrentDbPath(dbPath)
  applyRuntimeSettings(dbPath)
  updateRecent(dbPath)
  res.json({ path: dbPath, ...getProjectInitialData(dbPath) })
})

// GET /project/recent
router.get('/recent', (_req: Request, res: Response) => {
  const s = readAppSettings()
  res.json(s.recent || [])
})

// DELETE /project/recent — remove one entry from the recent list
router.delete('/recent', express.json(), (req: Request, res: Response) => {
  const { path: p } = req.body as { path?: string }
  if (!p) return res.status(400).json({ error: 'path required' })
  const s = readAppSettings()
  s.recent = (s.recent || []).filter((x) => x !== p)
  writeAppSettings(s)
  res.json({ ok: true })
})

// GET /project/files — list all supported project files in the projects directory
router.get('/files', (_req: Request, res: Response) => {
  const projectsDir = path.join(getDataDir(), 'projects')
  if (!fs.existsSync(projectsDir)) return res.json({ dir: projectsDir, files: [] })
  const files = fs
    .readdirSync(projectsDir)
    .filter((f) => f.endsWith('.sqlite') || f.endsWith('.db'))
    .map((f) => path.join(projectsDir, f))
  res.json({ dir: projectsDir, files })
})

// POST /project/open-folder — open the projects directory in the OS file manager
router.post('/open-folder', (_req: Request, res: Response) => {
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
  res.json({ ok: true })
})

// POST /project/create
router.post('/create', express.json(), (req: Request, res: Response) => {
  const body = req.body as { name?: string; text_language?: string } | undefined
  const name = body?.name ? body.name : `project-${Date.now()}`
  const text_language = body?.text_language ?? 'ru-RU'
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
      // Insert default nodes if none exist yet (e.g. DB was empty from a failed migration)
      const hasRoot = db.prepare('SELECT id FROM lore_nodes WHERE parent_id IS NULL LIMIT 1').get()
      if (!hasRoot) {
        const insertNode = db.prepare('INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)')
        const root = insertNode.run(null, defaultNodes.root)
        const rootId = root.lastInsertRowid
        for (const f of defaultNodes.children) insertNode.run(rootId, f)
      }
      db.close()
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
    setCurrentDbPath(dbPath)
    updateRecent(dbPath)
    return res.json({ path: dbPath, reused: true, ...getProjectInitialData(dbPath) })
  }

  try {
    const db: import('better-sqlite3').Database = openProjectDatabase(dbPath)

    // Insert root node and default children into lore_nodes table
    const insertNode = db.prepare('INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)')
    const root = insertNode.run(null, defaultNodes.root)
    const rootId = root.lastInsertRowid
    for (const f of defaultNodes.children) insertNode.run(rootId, f)

    // Store basic settings
    const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    setSetting.run('project_title', name)
    setSetting.run('locale', 'en')
    setSetting.run('text_language', text_language)

    // Create root plan node
    db.prepare('INSERT INTO plan_nodes (parent_id, title, position) VALUES (NULL, ?, 0)').run(name)

    db.close()

    setCurrentDbPath(dbPath)
    updateRecent(dbPath)

    return res.json({ path: dbPath, layout: null, projectTitle: name })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})

export default router
