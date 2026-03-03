import express, { Request, Response, Router } from 'express'
import type { PlanNodeRow, PlanNodeTree } from '../types/index.js'
import { getCurrentDbPath } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

// GET /plan/nodes
router.get('/nodes', (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const nodes = db
      .prepare(
        'SELECT id, parent_id, title, position, created_at FROM plan_nodes ORDER BY position, id',
      )
      .all() as PlanNodeRow[]
    db.close()

    const map = new Map<number, PlanNodeTree>()
    nodes.forEach((n) => map.set(n.id, { ...n, children: [] }))
    const roots: PlanNodeTree[] = []
    for (const n of map.values()) {
      if (n.parent_id != null && map.has(n.parent_id)) {
        map.get(n.parent_id)!.children.push(n)
      } else {
        roots.push(n)
      }
    }
    res.json(roots)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /plan/nodes
router.post('/nodes', express.json(), (req: Request, res: Response) => {
  const { parent_id, title, position } = req.body as {
    parent_id?: number | null
    title?: string
    position?: number
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !title) {
    return res.status(400).json({ error: 'title required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const info = db
      .prepare('INSERT INTO plan_nodes (parent_id, title, position) VALUES (?, ?, ?)')
      .run(parent_id ?? null, title, position ?? 0)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// GET /plan/nodes/:id/versions
router.get('/nodes/:id/versions', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const rows = db
      .prepare(
        'SELECT id, plan_node_id, version, instruction, result, status, parent_version_id, is_obsolete, created_at FROM plan_node_versions WHERE plan_node_id = ? ORDER BY version DESC',
      )
      .all(req.params.id)
    db.close()
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /plan/nodes/:id/versions
router.post('/nodes/:id/versions', express.json(), (req: Request, res: Response) => {
  const { summary, notes } = req.body as { summary?: string; notes?: string }
  const pid = req.params.id
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const cur = db
      .prepare(
        'SELECT COALESCE(MAX(version), 0) as v FROM plan_node_versions WHERE plan_node_id = ?',
      )
      .get(pid) as { v: number }
    const next = cur && cur.v ? cur.v + 1 : 1
    const info = db
      .prepare(
        'INSERT INTO plan_node_versions (plan_node_id, version, instruction, result) VALUES (?, ?, ?, ?)',
      )
      .run(pid, next, summary ?? null, notes ?? null)
    db.close()
    res.json({ id: info.lastInsertRowid, version: next })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /plan/restore/node_version/:id
router.post('/restore/node_version/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const old = db
      .prepare(
        'SELECT plan_node_id, instruction, result FROM plan_node_versions WHERE id = ?',
      )
      .get(req.params.id) as
      | { plan_node_id: number; instruction: string | null; result: string | null }
      | undefined
    if (!old) return res.status(404).json({ error: 'version not found' })
    const cur = db
      .prepare(
        'SELECT COALESCE(MAX(version),0) as v FROM plan_node_versions WHERE plan_node_id = ?',
      )
      .get(old.plan_node_id) as { v: number }
    const next = cur && cur.v ? cur.v + 1 : 1
    db.prepare(
      'INSERT INTO plan_node_versions (plan_node_id, version, instruction, result) VALUES (?, ?, ?, ?)',
    ).run(old.plan_node_id, next, old.instruction, old.result)
    db.close()
    res.json({ restoredVersion: next })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
