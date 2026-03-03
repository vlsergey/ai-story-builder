import express, { Request, Response, Router } from 'express'
import type { LoreFolderRow, LoreFolderNode } from '../types/index.js'
import { getCurrentDbPath } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

// GET /lore_folders/tree
router.get('/tree', (_req: Request, res: Response) => {
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.json([])
  try {
    const db = new Database(dbPath, { readonly: true })
    db.pragma('foreign_keys = ON')
    const folders = db
      .prepare('SELECT id, parent_id, name, created_at FROM lore_folders ORDER BY id')
      .all() as LoreFolderRow[]
    db.close()

    const map = new Map<number, LoreFolderNode>()
    folders.forEach((f) => map.set(f.id, { ...f, children: [] }))
    const roots: LoreFolderNode[] = []
    for (const f of map.values()) {
      if (f.parent_id != null && map.has(f.parent_id)) {
        map.get(f.parent_id)!.children.push(f)
      } else {
        roots.push(f)
      }
    }
    res.json(roots)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore_folders
router.post('/', express.json(), (req: Request, res: Response) => {
  const { parent_id, name } = req.body as { parent_id?: number; name?: string }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !name) {
    return res.status(400).json({ error: 'name required and db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const info = db
      .prepare('INSERT INTO lore_folders (parent_id, name) VALUES (?, ?)')
      .run(parent_id ?? null, name)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// DELETE /lore_folders/:id
router.delete('/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    db.prepare('DELETE FROM lore_folders WHERE id = ?').run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore_folders/:id/move
router.post('/:id/move', express.json(), (req: Request, res: Response) => {
  const { parent_id } = req.body as { parent_id?: number | null }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    db.prepare('UPDATE lore_folders SET parent_id = ? WHERE id = ?').run(
      parent_id ?? null,
      req.params.id,
    )
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// GET /lore_folders/:id/lore_items
router.get('/:id/lore_items', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const rows = db
      .prepare(
        'SELECT id, folder_id, slug, title, created_at FROM lore_items WHERE folder_id = ?',
      )
      .all(req.params.id)
    db.close()
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
