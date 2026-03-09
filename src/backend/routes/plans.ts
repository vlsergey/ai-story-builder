import type { PlanNodeRow, PlanNodeTree } from '../types/index.js'
import { getCurrentDbPath } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

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

// ── Exports ───────────────────────────────────────────────────────────────────

export function getPlanNodes(): PlanNodeTree[] {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
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
  return roots
}

export function getPlanNode(id: number): PlanNodeRow {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath, { readonly: true })
  const node = db.prepare('SELECT * FROM plan_nodes WHERE id = ?').get(id)
  db.close()
  if (!node) throw makeError('node not found', 404)
  return node as PlanNodeRow
}

export function createPlanNode(data: {
  parent_id?: number | null
  title?: string
  position?: number
  content?: string
}): { id: number | bigint } {
  const { parent_id, title, position, content } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath || !title) throw makeError('title required, db must be open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
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
  return { id: info.lastInsertRowid }
}

export function patchPlanNode(
  id: number,
  data: {
    title?: string
    content?: string
    prompt?: string
    start_review?: boolean
    accept_review?: boolean
    user_prompt?: string | null
    system_prompt?: string | null
  }
): { ok: boolean; word_count?: number | null; char_count?: number | null; byte_count?: number | null } {
  const { title, content, prompt, start_review, accept_review, user_prompt, system_prompt } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const hasTitle = typeof title === 'string' && title.trim().length > 0
  const hasContent = content !== undefined
  const hasUserPrompt = user_prompt !== undefined
  const hasSystemPrompt = system_prompt !== undefined
  if (!hasTitle && !hasContent && !accept_review && !hasUserPrompt && !hasSystemPrompt && prompt === undefined) {
    throw makeError('title, content, or accept_review required', 400)
  }

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

  if (hasUserPrompt) {
    sets.push('user_prompt = ?'); params.push(user_prompt ?? null)
  }

  if (hasSystemPrompt) {
    sets.push('system_prompt = ?'); params.push(system_prompt ?? null)
  }

  if (prompt !== undefined && !start_review) {
    sets.push('last_improve_instruction = ?'); params.push(prompt ?? null)
  }

  if (start_review && hasContent) {
    const cur = db
      .prepare('SELECT content, changes_status FROM plan_nodes WHERE id = ?')
      .get(id) as { content: string | null; changes_status: string | null } | undefined
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
    db.prepare(`UPDATE plan_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
  }
  db.close()
  return hasContent
    ? { ok: true, word_count: wordCount, char_count: charCount, byte_count: byteCount }
    : { ok: true }
}

export function deletePlanNode(id: number): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const node = db
    .prepare('SELECT parent_id FROM plan_nodes WHERE id = ?')
    .get(id) as { parent_id: number | null } | undefined
  if (!node) { db.close(); throw makeError('node not found', 404) }
  if (node.parent_id === null) { db.close(); throw makeError('root node cannot be deleted', 403) }
  db.prepare('DELETE FROM plan_nodes WHERE id = ?').run(id)
  db.close()
  return { ok: true }
}

export function movePlanNode(id: number, data: { parent_id?: number | null }): { ok: boolean } {
  const { parent_id } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const nodeId = Number(id)
  const newParentId = parent_id ?? null

  const node = db
    .prepare('SELECT parent_id FROM plan_nodes WHERE id = ?')
    .get(nodeId) as { parent_id: number | null } | undefined
  if (!node) { db.close(); throw makeError('node not found', 404) }
  if (node.parent_id === null) { db.close(); throw makeError('root node cannot be moved', 403) }
  if (newParentId === nodeId) { db.close(); throw makeError('cannot move node to itself', 400) }

  if (newParentId !== null) {
    const target = db.prepare('SELECT id FROM plan_nodes WHERE id = ?').get(newParentId)
    if (!target) { db.close(); throw makeError('target parent does not exist', 400) }

    const getParent = db.prepare('SELECT parent_id FROM plan_nodes WHERE id = ?')
    let cur: number | null = newParentId
    while (cur !== null) {
      if (cur === nodeId) { db.close(); throw makeError('cannot move node into its own descendant', 400) }
      cur = (getParent.get(cur) as { parent_id: number | null } | undefined)?.parent_id ?? null
    }
  }

  db.prepare('UPDATE plan_nodes SET parent_id = ? WHERE id = ?').run(newParentId, nodeId)
  db.close()
  return { ok: true }
}

export function reorderPlanChildren(child_ids: number[]): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Array.isArray(child_ids)) throw makeError('child_ids must be an array', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const update = db.prepare('UPDATE plan_nodes SET position = ? WHERE id = ?')
  db.transaction(() => { child_ids.forEach((id, i) => update.run(i, id)) })()
  db.close()
  return { ok: true }
}
