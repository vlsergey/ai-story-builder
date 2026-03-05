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

export default router
