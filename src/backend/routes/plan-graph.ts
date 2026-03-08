import express, { Request, Response, Router } from 'express'
import type { PlanNodeRow, PlanEdgeRow } from '../types/index.js'
import { getCurrentDbPath } from '../db/state.js'
import type { PlanGraphData } from '../../shared/plan-graph.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

// ── Content stats helpers ─────────────────────────────────────────────────────

function countWords(text: string): number {
  const t = text.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

function countChars(text: string): number {
  return [...text].length
}

function countBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

// GET /graph — full graph (nodes + edges)
router.get('/graph', (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const nodes = db.prepare(
      `SELECT id, type, title, content, user_prompt, system_prompt, summary, auto_summary,
              ai_sync_info, x, y, word_count, char_count, byte_count,
              changes_status, review_base_content, last_improve_instruction,
              last_generate_prompt, created_at
       FROM plan_nodes ORDER BY id`
    ).all() as PlanNodeRow[]
    const edges = db.prepare(
      `SELECT id, from_node_id, to_node_id, type, position, label, template
       FROM plan_edges ORDER BY position, id`
    ).all() as PlanEdgeRow[]
    db.close()
    res.json({ nodes, edges } as PlanGraphData)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /graph/nodes — create a node
router.post('/graph/nodes', express.json(), (req: Request, res: Response) => {
  const { type = 'text', title, x = 0, y = 0, user_prompt, system_prompt } = req.body as {
    type?: string
    title?: string
    x?: number
    y?: number
    user_prompt?: string
    system_prompt?: string
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !title) {
    return res.status(400).json({ error: 'title required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const info = db
      .prepare(
        `INSERT INTO plan_nodes (type, title, x, y, user_prompt, system_prompt, word_count, char_count, byte_count)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`
      )
      .run(type, title, x, y, user_prompt ?? null, system_prompt ?? null)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// GET /graph/nodes/:id — single node
router.get('/graph/nodes/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const node = db.prepare('SELECT * FROM plan_nodes WHERE id = ?').get(req.params.id)
    db.close()
    if (!node) return res.status(404).json({ error: 'node not found' })
    res.json(node)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PATCH /graph/nodes/:id — update writable fields
router.patch('/graph/nodes/:id', express.json(), (req: Request, res: Response) => {
  const {
    title, content, x, y, type,
    user_prompt, system_prompt, summary, auto_summary,
    prompt, start_review, accept_review, last_generate_prompt,
  } = req.body as {
    title?: string
    content?: string
    x?: number
    y?: number
    type?: string
    user_prompt?: string
    system_prompt?: string
    summary?: string
    auto_summary?: number
    prompt?: string
    start_review?: boolean
    accept_review?: boolean
    last_generate_prompt?: string | null
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  const hasTitle = typeof title === 'string' && title.trim().length > 0
  const hasContent = content !== undefined
  const hasPosition = x !== undefined || y !== undefined
  const hasType = type !== undefined
  const hasUserPrompt = user_prompt !== undefined
  const hasSystemPrompt = system_prompt !== undefined
  const hasSummary = summary !== undefined
  const hasAutoSummary = auto_summary !== undefined
  const hasLastGeneratePrompt = last_generate_prompt !== undefined

  if (!hasTitle && !hasContent && !hasPosition && !hasType && !hasUserPrompt &&
      !hasSystemPrompt && !hasSummary && !hasAutoSummary && !accept_review &&
      !hasLastGeneratePrompt && prompt === undefined) {
    return res.status(400).json({ error: 'at least one field required' })
  }

  try {
    const db = new Database(dbPath)
    const sets: string[] = []
    const params: (string | number | null)[] = []

    if (hasTitle) { sets.push('title = ?'); params.push(title!.trim()) }
    if (hasType) { sets.push('type = ?'); params.push(type!) }
    if (x !== undefined) { sets.push('x = ?'); params.push(x) }
    if (y !== undefined) { sets.push('y = ?'); params.push(y) }
    if (hasUserPrompt) { sets.push('user_prompt = ?'); params.push(user_prompt ?? null) }
    if (hasSystemPrompt) { sets.push('system_prompt = ?'); params.push(system_prompt ?? null) }
    if (hasSummary) { sets.push('summary = ?'); params.push(summary ?? null) }
    if (hasAutoSummary) { sets.push('auto_summary = ?'); params.push(auto_summary ?? 0) }

    const wordCount = hasContent ? countWords(content!) : null
    const charCount = hasContent ? countChars(content!) : null
    const byteCount = hasContent ? countBytes(content!) : null

    if (hasContent) {
      sets.push('content = ?'); params.push(content!)
      sets.push('word_count = ?'); params.push(wordCount!)
      sets.push('char_count = ?'); params.push(charCount!)
      sets.push('byte_count = ?'); params.push(byteCount!)
    }

    if (hasLastGeneratePrompt) {
      sets.push('last_generate_prompt = ?'); params.push(last_generate_prompt ?? null)
    }

    if (prompt !== undefined && !start_review) {
      sets.push('last_improve_instruction = ?'); params.push(prompt ?? null)
    }

    if (start_review && hasContent) {
      const cur = db
        .prepare('SELECT content, changes_status FROM plan_nodes WHERE id = ?')
        .get(req.params.id) as { content: string | null; changes_status: string | null } | undefined
      sets.push('changes_status = ?'); params.push('review')
      sets.push('last_improve_instruction = ?'); params.push(prompt ?? null)
      if (!cur || cur.changes_status !== 'review') {
        sets.push('review_base_content = ?'); params.push(cur?.content ?? '')
      }
    }

    if (accept_review) {
      sets.push('changes_status = ?'); params.push(null)
      sets.push('review_base_content = ?'); params.push(null)
      sets.push('last_improve_instruction = ?'); params.push(null)
    }

    if (sets.length > 0) {
      db.prepare(`UPDATE plan_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.params.id)
    }
    db.close()
    res.json(hasContent
      ? { ok: true, word_count: wordCount, char_count: charCount, byte_count: byteCount }
      : { ok: true }
    )
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// DELETE /graph/nodes/:id — cascade-deletes connected edges
router.delete('/graph/nodes/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const node = db.prepare('SELECT id FROM plan_nodes WHERE id = ?').get(req.params.id)
    if (!node) { db.close(); return res.status(404).json({ error: 'node not found' }) }
    db.prepare('DELETE FROM plan_nodes WHERE id = ?').run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /graph/edges — create an edge
router.post('/graph/edges', express.json(), (req: Request, res: Response) => {
  const { from_node_id, to_node_id, type = 'instruction', position = 0, label, template } = req.body as {
    from_node_id?: number
    to_node_id?: number
    type?: string
    position?: number
    label?: string
    template?: string
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (from_node_id == null || to_node_id == null) {
    return res.status(400).json({ error: 'from_node_id and to_node_id required' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const info = db
      .prepare(
        `INSERT INTO plan_edges (from_node_id, to_node_id, type, position, label, template)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(from_node_id, to_node_id, type, position, label ?? null, template ?? null)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PATCH /graph/edges/:id — update type/position/label/template
router.patch('/graph/edges/:id', express.json(), (req: Request, res: Response) => {
  const { type, position, label, template } = req.body as {
    type?: string
    position?: number
    label?: string
    template?: string
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  if (type == null && position == null && label === undefined && template === undefined) {
    return res.status(400).json({ error: 'at least one field required' })
  }
  try {
    const db = new Database(dbPath)
    const sets: string[] = []
    const params: (string | number | null)[] = []
    if (type !== undefined) { sets.push('type = ?'); params.push(type) }
    if (position !== undefined) { sets.push('position = ?'); params.push(position) }
    if (label !== undefined) { sets.push('label = ?'); params.push(label ?? null) }
    if (template !== undefined) { sets.push('template = ?'); params.push(template ?? null) }
    if (sets.length > 0) {
      db.prepare(`UPDATE plan_edges SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.params.id)
    }
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// DELETE /graph/edges/:id
router.delete('/graph/edges/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const edge = db.prepare('SELECT id FROM plan_edges WHERE id = ?').get(req.params.id)
    if (!edge) { db.close(); return res.status(404).json({ error: 'edge not found' }) }
    db.prepare('DELETE FROM plan_edges WHERE id = ?').run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
