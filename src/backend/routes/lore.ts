import express, { Request, Response, Router } from 'express'
import fs from 'fs'
import path from 'path'
import { getCurrentDbPath } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

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

const router: Router = express.Router()

// POST /lore_items
router.post('/', express.json(), (req: Request, res: Response) => {
  const { folder_id, slug, title } = req.body as {
    folder_id?: number
    slug?: string
    title?: string
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !folder_id || !slug) {
    return res
      .status(400)
      .json({ error: 'folder_id and slug required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const info = db
      .prepare('INSERT INTO lore_items (folder_id, slug, title) VALUES (?, ?, ?)')
      .run(folder_id, slug, title ?? null)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// GET /lore_items/:id/versions
router.get('/:id/versions', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const rows = db
      .prepare(
        'SELECT id, version, content, created_at FROM lore_versions WHERE lore_item_id = ? ORDER BY version DESC',
      )
      .all(req.params.id)
    db.close()
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore_items/:id/versions
router.post('/:id/versions', express.json(), (req: Request, res: Response) => {
  const { content } = req.body as { content?: string }
  const lid = req.params.id
  const dbPath = getCurrentDbPath()
  if (!dbPath || !content) {
    return res.status(400).json({ error: 'content required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const cur = db
      .prepare(
        'SELECT COALESCE(MAX(version), 0) as v FROM lore_versions WHERE lore_item_id = ?',
      )
      .get(lid) as { v: number }
    const next = cur && cur.v ? cur.v + 1 : 1
    const info = db
      .prepare(
        'INSERT INTO lore_versions (lore_item_id, version, content) VALUES (?, ?, ?)',
      )
      .run(lid, next, content)
    db.close()
    res.json({ id: info.lastInsertRowid, version: next })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// GET /lore_items/:id/latest
router.get('/:id/latest', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .prepare(
        'SELECT * FROM lore_versions WHERE lore_item_id = ? ORDER BY version DESC LIMIT 1',
      )
      .get(req.params.id)
    db.close()
    res.json(row ?? null)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore_items/import  (must come BEFORE /:id routes to avoid capture)
router.post('/import', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'file required' })
  const dbPath = getCurrentDbPath()
  const folder_id = (req.body as { folder_id?: string }).folder_id
  if (!dbPath || !folder_id) {
    return res.status(400).json({ error: 'db not open, folder_id required' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const content = fs.readFileSync(req.file.path, 'utf8')
    const slug = path
      .basename(req.file.originalname, path.extname(req.file.originalname))
      .replace(/[^a-z0-9\-_]/gi, '_')
    const title = req.file.originalname
    const db = new Database(dbPath)
    const info = db
      .prepare('INSERT INTO lore_items (folder_id, slug, title) VALUES (?, ?, ?)')
      .run(folder_id, slug, title)
    const lid = info.lastInsertRowid
    db.prepare(
      'INSERT INTO lore_versions (lore_item_id, version, content) VALUES (?, ?, ?)',
    ).run(lid, 1, content)
    db.close()
    try { fs.unlinkSync(req.file.path) } catch (_) {}
    res.json({ id: lid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore_items/restore/:id
router.post('/restore/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const old = db
      .prepare('SELECT lore_item_id, content FROM lore_versions WHERE id = ?')
      .get(req.params.id) as { lore_item_id: number; content: string } | undefined
    if (!old) return res.status(404).json({ error: 'version not found' })
    const cur = db
      .prepare(
        'SELECT COALESCE(MAX(version),0) as v FROM lore_versions WHERE lore_item_id = ?',
      )
      .get(old.lore_item_id) as { v: number }
    const next = cur && cur.v ? cur.v + 1 : 1
    db.prepare(
      'INSERT INTO lore_versions (lore_item_id, version, content) VALUES (?, ?, ?)',
    ).run(old.lore_item_id, next, old.content)
    db.close()
    res.json({ restoredVersion: next })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
