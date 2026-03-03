import express, { Request, Response, Router } from 'express'
import fs from 'fs'
import path from 'path'
import type { LoreNodeRow, LoreTreeNode } from '../types/index.js'
import { getCurrentDbPath, getDataDir } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

let upload: { single: (field: string) => express.RequestHandler }
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const multer = require('multer') as typeof import('multer')
  upload = multer({ dest: path.join(getDataDir(), 'uploads') })
} catch (_) {
  upload = {
    single: () => (_req: Request, res: Response) => {
      res.status(501).json({ error: 'file upload not available (multer missing)' })
    },
  }
}

const router: Router = express.Router()

// ── Tree ──────────────────────────────────────────────────────────────────────

// GET /lore_nodes/tree — full lore tree with latest version status per node
router.get('/tree', (_req: Request, res: Response) => {
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.json([])
  try {
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare(`
      SELECT n.id, n.parent_id, n.name, n.position, n.status, n.created_at,
        (SELECT lv.status FROM lore_versions lv
         WHERE lv.lore_node_id = n.id ORDER BY lv.version DESC LIMIT 1
        ) AS latest_version_status
      FROM lore_nodes n
      ORDER BY n.parent_id NULLS FIRST, n.position, n.name
    `).all() as (LoreNodeRow & { latest_version_status: string | null })[]
    db.close()

    const map = new Map<number, LoreTreeNode>()
    rows.forEach(r => map.set(r.id, { ...r, children: [] }))
    const roots: LoreTreeNode[] = []
    for (const node of map.values()) {
      if (node.parent_id != null && map.has(node.parent_id)) {
        map.get(node.parent_id)!.children.push(node)
      } else {
        roots.push(node)
      }
    }
    res.json(roots)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Import (must precede /:id routes) ─────────────────────────────────────────

// POST /lore_nodes/import — upload a file and create a node with its content
router.post('/import', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'file required' })
  const dbPath = getCurrentDbPath()
  const { parent_id } = req.body as { parent_id?: string }
  if (!dbPath || !parent_id) return res.status(400).json({ error: 'db not open, parent_id required' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const content = fs.readFileSync(req.file.path, 'utf8')
    const name = req.file.originalname
    const db = new Database(dbPath)
    const info = db
      .prepare('INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)')
      .run(parent_id, name)
    const nodeId = info.lastInsertRowid
    db.prepare('INSERT INTO lore_versions (lore_node_id, version, content) VALUES (?, 1, ?)').run(nodeId, content)
    db.close()
    try { fs.unlinkSync(req.file.path) } catch (_) {}
    res.json({ id: nodeId })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Restore a version ─────────────────────────────────────────────────────────

// POST /lore_nodes/restore/:version_id — make a copy of an old version as the new latest
router.post('/restore/:version_id', (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const old = db
      .prepare('SELECT lore_node_id, content FROM lore_versions WHERE id = ?')
      .get(_req.params.version_id) as { lore_node_id: number; content: string } | undefined
    if (!old) return res.status(404).json({ error: 'version not found' })
    const cur = db
      .prepare('SELECT COALESCE(MAX(version),0) AS v FROM lore_versions WHERE lore_node_id = ?')
      .get(old.lore_node_id) as { v: number }
    const next = (cur?.v ?? 0) + 1
    db.prepare('INSERT INTO lore_versions (lore_node_id, version, content) VALUES (?, ?, ?)').run(
      old.lore_node_id, next, old.content,
    )
    db.close()
    res.json({ restoredVersion: next })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── CRUD ──────────────────────────────────────────────────────────────────────

// POST /lore_nodes — create a node
router.post('/', express.json(), (req: Request, res: Response) => {
  const { parent_id, name } = req.body as { parent_id?: number | null; name?: string }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !name?.trim()) return res.status(400).json({ error: 'name required and db must be open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const info = db
      .prepare('INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)')
      .run(parent_id ?? null, name.trim())
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PATCH /lore_nodes/:id — rename a node
router.patch('/:id', express.json(), (req: Request, res: Response) => {
  const { name } = req.body as { name?: string }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !name?.trim()) return res.status(400).json({ error: 'name required and db must be open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    db.prepare('UPDATE lore_nodes SET name = ? WHERE id = ?').run(name.trim(), req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// DELETE /lore_nodes/:id — soft-delete (root node protected)
router.delete('/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const node = db
      .prepare('SELECT parent_id FROM lore_nodes WHERE id = ?')
      .get(req.params.id) as { parent_id: number | null } | undefined
    if (!node) return res.status(404).json({ error: 'node not found' })
    if (node.parent_id === null) {
      db.close()
      return res.status(403).json({ error: 'root node cannot be deleted' })
    }
    db.prepare("UPDATE lore_nodes SET status = 'TO_BE_DELETED' WHERE id = ?").run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore_nodes/:id/move — change parent
router.post('/:id/move', express.json(), (req: Request, res: Response) => {
  const { parent_id } = req.body as { parent_id?: number | null }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    db.prepare('UPDATE lore_nodes SET parent_id = ? WHERE id = ?').run(parent_id ?? null, req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore_nodes/:id/duplicate — copy node and its latest version content
router.post('/:id/duplicate', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const src = db
      .prepare('SELECT parent_id, name FROM lore_nodes WHERE id = ?')
      .get(req.params.id) as { parent_id: number | null; name: string } | undefined
    if (!src) return res.status(404).json({ error: 'node not found' })

    const baseName = src.name + ' copy'
    const existing = db
      .prepare("SELECT name FROM lore_nodes WHERE parent_id IS ? AND name LIKE ? || '%'")
      .all(src.parent_id, baseName) as { name: string }[]
    const usedNames = new Set(existing.map(r => r.name))
    let newName = baseName
    let n = 2
    while (usedNames.has(newName)) newName = `${baseName} ${n++}`

    const info = db.prepare('INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)').run(src.parent_id, newName)
    const newId = info.lastInsertRowid

    const latest = db
      .prepare('SELECT content FROM lore_versions WHERE lore_node_id = ? ORDER BY version DESC LIMIT 1')
      .get(req.params.id) as { content: string } | undefined
    if (latest) {
      db.prepare('INSERT INTO lore_versions (lore_node_id, version, content) VALUES (?, 1, ?)').run(newId, latest.content)
    }
    db.close()
    res.json({ id: newId })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Versions ──────────────────────────────────────────────────────────────────

// GET /lore_nodes/:id/versions
router.get('/:id/versions', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const rows = db
      .prepare('SELECT id, version, content, status, created_at FROM lore_versions WHERE lore_node_id = ? ORDER BY version DESC')
      .all(req.params.id)
    db.close()
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore_nodes/:id/versions
router.post('/:id/versions', express.json(), (req: Request, res: Response) => {
  const { content } = req.body as { content?: string }
  const dbPath = getCurrentDbPath()
  if (!dbPath || content === undefined) return res.status(400).json({ error: 'content required and db must be open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const cur = db
      .prepare('SELECT COALESCE(MAX(version),0) AS v FROM lore_versions WHERE lore_node_id = ?')
      .get(req.params.id) as { v: number }
    const next = (cur?.v ?? 0) + 1
    const info = db
      .prepare('INSERT INTO lore_versions (lore_node_id, version, content) VALUES (?, ?, ?)')
      .run(req.params.id, next, content)
    db.close()
    res.json({ id: info.lastInsertRowid, version: next })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// GET /lore_nodes/:id/latest
router.get('/:id/latest', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .prepare('SELECT * FROM lore_versions WHERE lore_node_id = ? ORDER BY version DESC LIMIT 1')
      .get(req.params.id)
    db.close()
    res.json(row ?? null)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
