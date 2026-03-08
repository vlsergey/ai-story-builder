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

// GET /plan/nodes — full tree
router.get('/nodes', (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const nodes = db
      .prepare(
        `SELECT id, parent_id, title, content, position, created_at,
                word_count, char_count, byte_count, changes_status, review_base_content, last_improve_instruction
         FROM plan_nodes ORDER BY position, id`,
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

// GET /plan/nodes/:id — single node
router.get('/nodes/:id', (req: Request, res: Response) => {
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

// POST /plan/nodes — create a node
router.post('/nodes', express.json(), (req: Request, res: Response) => {
  const { parent_id, title, position, content } = req.body as {
    parent_id?: number | null
    title?: string
    position?: number
    content?: string
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !title) {
    return res.status(400).json({ error: 'title required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const pid = parent_id ?? null
    const { m } = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM plan_nodes WHERE parent_id IS ?')
      .get(pid) as { m: number }
    let wordCount = 0, charCount = 0, byteCount = 0
    if (content) {
      wordCount = countWords(content)
      charCount = countChars(content)
      byteCount = countBytes(content)
    }
    const info = db
      .prepare('INSERT INTO plan_nodes (parent_id, title, position, content, word_count, char_count, byte_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(pid, title, position ?? m + 1, content ?? null, wordCount, charCount, byteCount)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PATCH /plan/nodes/:id — update title/content; supports start_review, accept_review
router.patch('/nodes/:id', express.json(), (req: Request, res: Response) => {
  const {
    title, content, prompt,
    start_review, accept_review,
    user_prompt, system_prompt,
  } = req.body as {
    title?: string
    content?: string
    /** AI improve instruction; saved to last_improve_instruction (always when provided) */
    prompt?: string
    start_review?: boolean
    accept_review?: boolean
    /** User prompt for generation (replaces last_generate_prompt for plan nodes) */
    user_prompt?: string | null
    /** System prompt for generation (plan nodes only) */
    system_prompt?: string | null
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  const hasTitle = typeof title === 'string' && title.trim().length > 0
  const hasContent = content !== undefined
  const hasUserPrompt = user_prompt !== undefined
  const hasSystemPrompt = system_prompt !== undefined
  if (!hasTitle && !hasContent && !accept_review && !hasUserPrompt && !hasSystemPrompt && prompt === undefined) {
    return res.status(400).json({ error: 'title, content, or accept_review required' })
  }
  try {
    const db = new Database(dbPath)
    const sets: string[] = []
    const params: (string | number | null)[] = []

    if (hasTitle) { sets.push('title = ?'); params.push(title!.trim()) }

    const wordCount = hasContent ? countWords(content!) : null
    const charCount = hasContent ? countChars(content!) : null
    const byteCount = hasContent ? countBytes(content!) : null

    if (hasContent) {
      sets.push('content = ?'); params.push(content!)
      sets.push('word_count = ?'); params.push(wordCount!)
      sets.push('char_count = ?'); params.push(charCount!)
      sets.push('byte_count = ?'); params.push(byteCount!)
    }

    // Save user prompt
    if (hasUserPrompt) {
      sets.push('user_prompt = ?'); params.push(user_prompt ?? null)
    }

    // Save system prompt (plan nodes only)
    if (hasSystemPrompt) {
      sets.push('system_prompt = ?'); params.push(system_prompt ?? null)
    }

    // Save improve instruction whenever provided (first improve OR re-improve)
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

// DELETE /plan/nodes/:id — hard delete (children cascade)
router.delete('/nodes/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const node = db
      .prepare('SELECT parent_id FROM plan_nodes WHERE id = ?')
      .get(req.params.id) as { parent_id: number | null } | undefined
    if (!node) { db.close(); return res.status(404).json({ error: 'node not found' }) }
    if (node.parent_id === null) { db.close(); return res.status(403).json({ error: 'root node cannot be deleted' }) }
    db.prepare('DELETE FROM plan_nodes WHERE id = ?').run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PATCH /plan/nodes/:id/move — reparent and/or reorder
router.patch('/nodes/:id/move', express.json(), (req: Request, res: Response) => {
  const { parent_id } = req.body as { parent_id?: number | null }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const nodeId = Number(req.params.id)
    const newParentId = parent_id ?? null

    const node = db
      .prepare('SELECT parent_id FROM plan_nodes WHERE id = ?')
      .get(nodeId) as { parent_id: number | null } | undefined
    if (!node) { db.close(); return res.status(404).json({ error: 'node not found' }) }
    if (node.parent_id === null) { db.close(); return res.status(403).json({ error: 'root node cannot be moved' }) }
    if (newParentId === nodeId) { db.close(); return res.status(400).json({ error: 'cannot move node to itself' }) }

    if (newParentId !== null) {
      const target = db.prepare('SELECT id FROM plan_nodes WHERE id = ?').get(newParentId)
      if (!target) { db.close(); return res.status(400).json({ error: 'target parent does not exist' }) }

      // Cycle check
      const getParent = db.prepare('SELECT parent_id FROM plan_nodes WHERE id = ?')
      let cur: number | null = newParentId
      while (cur !== null) {
        if (cur === nodeId) { db.close(); return res.status(400).json({ error: 'cannot move node into its own descendant' }) }
        cur = (getParent.get(cur) as { parent_id: number | null } | undefined)?.parent_id ?? null
      }
    }

    db.prepare('UPDATE plan_nodes SET parent_id = ? WHERE id = ?').run(newParentId, nodeId)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /plan/nodes/reorder-children — set positions of direct children in given order
router.post('/nodes/reorder-children', express.json(), (req: Request, res: Response) => {
  const { child_ids } = req.body as { child_ids?: number[] }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Array.isArray(child_ids)) return res.status(400).json({ error: 'child_ids must be an array' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const update = db.prepare('UPDATE plan_nodes SET position = ? WHERE id = ?')
    db.transaction(() => { child_ids.forEach((id, i) => update.run(i, id)) })()
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
