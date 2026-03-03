import express, { Request, Response, Router } from 'express'
import fs from 'fs'
import path from 'path'
import type { ProjectInitialData } from '../types/index.js'
import {
  getCurrentDbPath,
  setCurrentDbPath,
  readAppSettings,
  writeAppSettings,
} from '../db/state.js'

// openProjectDatabase is a CommonJS module; use require to load it at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openProjectDatabase } = require('../db/index.js') as {
  openProjectDatabase: (dbPath: string) => import('better-sqlite3').Database
}

// better-sqlite3 is optional
let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

// multer is an optional dependency
let upload: {
  single: (field: string) => express.RequestHandler
}
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const multer = require('multer') as typeof import('multer')
  upload = multer({ dest: path.join(process.cwd(), 'data', 'uploads') })
} catch (_) {
  upload = {
    single: () => (_req: Request, res: Response) => {
      res.status(501).json({ error: 'file upload not available (multer missing)' })
    },
  }
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

  setCurrentDbPath(dbPath)

  let versionState = 'unknown'
  if (Database) {
    try {
      const db = new Database(dbPath, { readonly: true })
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
        .get()
      versionState = row ? 'ok' : 'old'
      db.close()
    } catch (e) {
      return res.status(500).json({ error: 'failed to open database: ' + String(e) })
    }
  }

  updateRecent(dbPath)
  res.json({ path: dbPath, versionState, ...getProjectInitialData(dbPath) })
})

// GET /project/recent
router.get('/recent', (_req: Request, res: Response) => {
  const s = readAppSettings()
  res.json(s.recent || [])
})

// POST /project/upload
router.post('/upload', upload.single('dbfile'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })

  const projectsDir = path.join(process.cwd(), 'data', 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const dest = path.join(projectsDir, req.file.originalname)
  fs.renameSync(req.file.path, dest)

  setCurrentDbPath(dest)

  // create backup
  const backupsDir = path.join(process.cwd(), 'data', 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupName = `${req.file.originalname}.${ts}.bak`
  fs.copyFileSync(dest, path.join(backupsDir, backupName))

  // trim backups to last 7
  const prefix = req.file.originalname + '.'
  const all = fs.readdirSync(backupsDir).filter((f) => f.startsWith(prefix))
  all.sort()
  while (all.length > 7) {
    const rm = all.shift()!
    try { fs.unlinkSync(path.join(backupsDir, rm)) } catch (_) {}
  }

  updateRecent(dest)

  let versionState = 'unknown'
  if (Database) {
    try {
      const db = new Database(dest, { readonly: true })
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
        .get()
      versionState = row ? 'ok' : 'old'
      db.close()
    } catch (_) {
      versionState = 'error'
    }
  }

  res.json({ path: dest, backup: backupName, versionState, ...getProjectInitialData(dest) })
})

// POST /project/create
router.post('/create', express.json(), (req: Request, res: Response) => {
  const name =
    req.body && (req.body as { name?: string }).name
      ? (req.body as { name: string }).name
      : `project-${Date.now()}`
  const safeName = name.replace(/[^a-zA-Z0-9\-_.]/g, '_')
  const projectsDir = path.join(process.cwd(), 'data', 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const dbPath = path.join(projectsDir, `${safeName}.sqlite`)

  if (fs.existsSync(dbPath)) {
    setCurrentDbPath(dbPath)
    updateRecent(dbPath)
    return res.json({ path: dbPath, reused: true, ...getProjectInitialData(dbPath) })
  }

  try {
    const db: import('better-sqlite3').Database = openProjectDatabase(dbPath)

    // Insert root folder and default children into lore_folders table
    const insertFolder = db.prepare('INSERT INTO lore_folders (parent_id, name) VALUES (?, ?)')
    const root = insertFolder.run(null, 'Story Lore')
    const rootId = root.lastInsertRowid
    const defaults = ['locations', 'abilities', 'spells', 'bestiary', 'characters']
    for (const f of defaults) insertFolder.run(rootId, f)

    // Store basic settings
    const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    setSetting.run('project_title', name)
    setSetting.run('locale', 'en')

    db.close()

    setCurrentDbPath(dbPath)
    updateRecent(dbPath)

    return res.json({ path: dbPath, layout: null, projectTitle: name })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})

export default router
