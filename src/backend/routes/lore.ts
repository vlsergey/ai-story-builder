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

// GET /lore/tree — full lore tree with latest version status per node
router.get('/tree', (_req: Request, res: Response) => {
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.json([])
  try {
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare(`
      SELECT n.id, n.parent_id, n.name, n.position, n.status, n.to_be_deleted, n.created_at,
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

// POST /lore/import — upload a file and create a node with its content
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

// POST /lore/restore/:version_id — make a copy of an old version as the new latest
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

// POST /lore — create a node (appended at the end of the parent's children)
router.post('/', express.json(), (req: Request, res: Response) => {
  const { parent_id, name } = req.body as { parent_id?: number | null; name?: string }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !name?.trim()) return res.status(400).json({ error: 'name required and db must be open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const pid = parent_id ?? null
    const { m } = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM lore_nodes WHERE parent_id IS ?')
      .get(pid) as { m: number }
    const info = db
      .prepare('INSERT INTO lore_nodes (parent_id, name, position) VALUES (?, ?, ?)')
      .run(pid, name.trim(), m + 1)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore/reorder-children — set positions of direct children in the given order
router.post('/reorder-children', express.json(), (req: Request, res: Response) => {
  const { child_ids } = req.body as { child_ids?: number[] }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Array.isArray(child_ids)) return res.status(400).json({ error: 'child_ids must be an array' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const update = db.prepare('UPDATE lore_nodes SET position = ? WHERE id = ?')
    db.transaction(() => { child_ids.forEach((id, i) => update.run(i, id)) })()
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PATCH /lore/:id — rename a node
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

// DELETE /lore/:id — mark node and all descendants as to_be_deleted (root protected)
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
    db.prepare(`
      WITH RECURSIVE sub AS (
        SELECT id FROM lore_nodes WHERE id = ?
        UNION ALL
        SELECT n.id FROM lore_nodes n INNER JOIN sub s ON n.parent_id = s.id
      )
      UPDATE lore_nodes SET to_be_deleted = 1 WHERE id IN (SELECT id FROM sub)
    `).run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore/:id/restore — clear to_be_deleted on node and all descendants
router.post('/:id/restore', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    db.prepare(`
      WITH RECURSIVE sub AS (
        SELECT id FROM lore_nodes WHERE id = ?
        UNION ALL
        SELECT n.id FROM lore_nodes n INNER JOIN sub s ON n.parent_id = s.id
      )
      UPDATE lore_nodes SET to_be_deleted = 0 WHERE id IN (SELECT id FROM sub)
    `).run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore/:id/sort-children — sort direct children alphabetically by name
router.post('/:id/sort-children', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const children = db
      .prepare('SELECT id FROM lore_nodes WHERE parent_id = ? ORDER BY name COLLATE NOCASE ASC')
      .all(req.params.id) as { id: number }[]
    const update = db.prepare('UPDATE lore_nodes SET position = ? WHERE id = ?')
    db.transaction(() => { children.forEach((c, i) => update.run(i, c.id)) })()
    db.close()
    res.json({ ok: true, sorted: children.length })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore/:id/move — change parent
router.post('/:id/move', express.json(), (req: Request, res: Response) => {
  const { parent_id } = req.body as { parent_id?: number | null }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const nodeId = Number(req.params.id)
    const newParentId = parent_id ?? null

    // Root node cannot be moved
    const node = db
      .prepare('SELECT parent_id, to_be_deleted FROM lore_nodes WHERE id = ?')
      .get(nodeId) as { parent_id: number | null; to_be_deleted: number } | undefined
    if (!node) { db.close(); return res.status(404).json({ error: 'node not found' }) }
    if (node.parent_id === null) { db.close(); return res.status(403).json({ error: 'root node cannot be moved' }) }

    // Cannot move to self
    if (newParentId === nodeId) { db.close(); return res.status(400).json({ error: 'cannot move node to itself' }) }

    // Target parent must exist
    if (newParentId !== null) {
      const target = db
        .prepare('SELECT id, to_be_deleted FROM lore_nodes WHERE id = ?')
        .get(newParentId) as { id: number; to_be_deleted: number } | undefined
      if (!target) { db.close(); return res.status(400).json({ error: 'target parent does not exist' }) }
      // Cannot move an active node into a node marked for deletion
      if (target.to_be_deleted && !node.to_be_deleted) {
        db.close()
        return res.status(400).json({ error: 'cannot move active node into a node marked for deletion' })
      }
    }

    // Cannot move to a descendant (would create a cycle)
    if (newParentId !== null) {
      const getParent = db.prepare('SELECT parent_id FROM lore_nodes WHERE id = ?')
      let cur: number | null = newParentId
      while (cur !== null) {
        if (cur === nodeId) {
          db.close()
          return res.status(400).json({ error: 'cannot move node into its own descendant' })
        }
        cur = (getParent.get(cur) as { parent_id: number | null } | undefined)?.parent_id ?? null
      }
    }

    db.prepare('UPDATE lore_nodes SET parent_id = ? WHERE id = ?').run(newParentId, nodeId)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /lore/:id/duplicate — copy node and its latest version content
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

// GET /lore/:id/versions
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

// POST /lore/:id/versions
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

// GET /lore/:id/latest
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
