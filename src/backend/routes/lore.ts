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

// ── Content stats helpers ─────────────────────────────────────────────────────

function countWords(text: string): number {
  const t = text.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

function countChars(text: string): number {
  return [...text].length  // Unicode code points
}

function countBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

// ── Tree ──────────────────────────────────────────────────────────────────────

// GET /lore/tree — full lore tree
router.get('/tree', (_req: Request, res: Response) => {
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.json([])
  try {
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare(`
      SELECT n.id, n.parent_id, n.name, n.content, n.position, n.status, n.to_be_deleted, n.created_at,
        n.word_count, n.char_count, n.byte_count, n.ai_sync_info, n.changes_status, n.review_base_content
      FROM lore_nodes n
      ORDER BY n.parent_id NULLS FIRST, n.position, n.name
    `).all() as LoreNodeRow[]
    db.close()

    const map = new Map<number, LoreTreeNode>()
    rows.forEach(r => map.set(r.id, {
      ...r,
      ai_sync_info: r.ai_sync_info ? JSON.parse(r.ai_sync_info) : null,
      children: [],
    }))
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
    const wordCount = countWords(content)
    const charCount = countChars(content)
    const byteCount = countBytes(content)
    const info = db
      .prepare('INSERT INTO lore_nodes (parent_id, name, content, word_count, char_count, byte_count) VALUES (?, ?, ?, ?, ?, ?)')
      .run(parent_id, name, content, wordCount, charCount, byteCount)
    const nodeId = info.lastInsertRowid
    db.close()
    try { fs.unlinkSync(req.file.path) } catch (_) {}
    res.json({ id: nodeId })
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

// GET /lore/:id — fetch a single node (including content)
router.get('/:id', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const node = db.prepare('SELECT * FROM lore_nodes WHERE id = ?').get(req.params.id)
    db.close()
    if (!node) return res.status(404).json({ error: 'node not found' })
    res.json(node)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PATCH /lore/:id — update name and/or content of a node
router.patch('/:id', express.json(), (req: Request, res: Response) => {
  const {
    name, content, prompt,
    start_review, accept_review, last_generate_prompt,
  } = req.body as {
    name?: string
    content?: string
    /** AI improve instruction; saved to last_improve_instruction (always when provided) */
    prompt?: string
    /** When true: capture current content as review_base_content, set changes_status='review'.
     *  Must be combined with a content update. */
    start_review?: boolean
    /** When true: clear changes_status, review_base_content, and last_improve_instruction. */
    accept_review?: boolean
    /** Generate prompt (mode A); saved independently to last_generate_prompt */
    last_generate_prompt?: string | null
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  const hasName = typeof name === 'string' && name.trim().length > 0
  const hasContent = content !== undefined
  const hasLastGeneratePrompt = last_generate_prompt !== undefined
  if (!hasName && !hasContent && !accept_review && !hasLastGeneratePrompt && prompt === undefined)
    return res.status(400).json({ error: 'name or content required' })
  try {
    const db = new Database(dbPath)
    const sets: string[] = []
    const params: (string | number | null)[] = []
    if (hasName) { sets.push('name = ?'); params.push(name!.trim()) }
    const wordCount = hasContent ? countWords(content!) : null
    const charCount = hasContent ? countChars(content!) : null
    const byteCount = hasContent ? countBytes(content!) : null
    let updatedSyncInfo: Record<string, Record<string, unknown>> | null = null
    if (hasContent) {
      sets.push('content = ?'); params.push(content!)
      sets.push('word_count = ?');  params.push(wordCount!)
      sets.push('char_count = ?');  params.push(charCount!)
      sets.push('byte_count = ?');  params.push(byteCount!)
      // Update content_updated_at inside ai_sync_info for each engine
      const now = new Date().toISOString()
      const existingRow = db
        .prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = ?')
        .get(req.params.id) as { ai_sync_info: string | null } | undefined
      if (existingRow?.ai_sync_info) {
        try {
          const syncInfo = JSON.parse(existingRow.ai_sync_info) as Record<string, Record<string, unknown>>
          for (const engine of Object.keys(syncInfo)) {
            syncInfo[engine] = { ...syncInfo[engine], content_updated_at: now }
          }
          sets.push('ai_sync_info = ?')
          params.push(JSON.stringify(syncInfo))
          updatedSyncInfo = syncInfo
        } catch { /* ignore malformed JSON */ }
      }
    }

    // Save generate prompt independently (mode A)
    if (hasLastGeneratePrompt) {
      sets.push('last_generate_prompt = ?'); params.push(last_generate_prompt ?? null)
    }

    // Save improve instruction whenever provided (first improve OR re-improve)
    if (prompt !== undefined && !start_review) {
      sets.push('last_improve_instruction = ?'); params.push(prompt ?? null)
    }

    // For start_review: read current node state before the transaction so we can decide
    // whether to capture review_base_content (only on first improvement, not on repeat).
    if (start_review && hasContent) {
      const cur = db
        .prepare('SELECT content, changes_status FROM lore_nodes WHERE id = ?')
        .get(req.params.id) as { content: string | null; changes_status: string | null } | undefined
      sets.push('changes_status = ?'); params.push('review')
      sets.push('last_improve_instruction = ?'); params.push(prompt ?? null)
      if (!cur || cur.changes_status !== 'review') {
        // First improvement: capture current content as baseline for diffs
        sets.push('review_base_content = ?'); params.push(cur?.content ?? '')
      }
      // Repeat improvement: don't touch review_base_content (keep original baseline)
    }

    if (accept_review) {
      sets.push('changes_status = ?'); params.push(null)
      sets.push('review_base_content = ?'); params.push(null)
      sets.push('last_improve_instruction = ?'); params.push(null)
    }

    if (sets.length > 0) {
      db.prepare(`UPDATE lore_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.params.id)
    }
    db.close()
    res.json(hasContent
      ? { ok: true, word_count: wordCount, char_count: charCount, byte_count: byteCount, ai_sync_info: updatedSyncInfo }
      : { ok: true }
    )
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

// POST /lore/:id/duplicate — copy node and its content
router.post('/:id/duplicate', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const src = db
      .prepare('SELECT parent_id, name, content FROM lore_nodes WHERE id = ?')
      .get(req.params.id) as { parent_id: number | null; name: string; content: string | null } | undefined
    if (!src) return res.status(404).json({ error: 'node not found' })

    const baseName = src.name + ' copy'
    const existing = db
      .prepare("SELECT name FROM lore_nodes WHERE parent_id IS ? AND name LIKE ? || '%'")
      .all(src.parent_id, baseName) as { name: string }[]
    const usedNames = new Set(existing.map(r => r.name))
    let newName = baseName
    let n = 2
    while (usedNames.has(newName)) newName = `${baseName} ${n++}`

    let info
    if (src.content) {
      const wordCount = countWords(src.content)
      const charCount = countChars(src.content)
      const byteCount = countBytes(src.content)
      info = db.prepare(
        'INSERT INTO lore_nodes (parent_id, name, content, word_count, char_count, byte_count) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(src.parent_id, newName, src.content, wordCount, charCount, byteCount)
    } else {
      info = db.prepare('INSERT INTO lore_nodes (parent_id, name) VALUES (?, ?)').run(src.parent_id, newName)
    }
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
