import fs from 'fs'
import type { LoreNodeRow, LoreTreeNode } from '../types/index.js'
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
  return [...text].length  // Unicode code points
}

function countBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

// ── Tree ──────────────────────────────────────────────────────────────────────

export function getLoreTree(): LoreTreeNode[] {
  if (!Database) throw makeError('SQLite lib missing', 500)
  const dbPath = getCurrentDbPath()
  if (!dbPath) return []
  const db = new Database(dbPath, { readonly: true })
  const rows = db.prepare(`
    SELECT n.id, n.parent_id, n.name, n.content, n.position, n.status, n.to_be_deleted, n.created_at,
      n.word_count, n.char_count, n.byte_count, n.ai_sync_info, n.ai_settings, n.changes_status, n.review_base_content
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
  return roots
}

// ── Import ─────────────────────────────────────────────────────────────────────

export function importLoreNode(data: { name: string; content: string; parentId: number }): { id: number | bigint } {
  const { name, content, parentId } = data
  if (!Database) throw makeError('SQLite lib missing', 500)
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('db not open', 400)
  const wordCount = countWords(content)
  const charCount = countChars(content)
  const byteCount = countBytes(content)
  const db = new Database(dbPath)
  const info = db
    .prepare('INSERT INTO lore_nodes (parent_id, name, content, word_count, char_count, byte_count) VALUES (?, ?, ?, ?, ?, ?)')
    .run(parentId, name, content, wordCount, charCount, byteCount)
  const nodeId = info.lastInsertRowid
  db.close()
  return { id: nodeId }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createLoreNode(data: { parent_id?: number | null; name: string }): { id: number | bigint } {
  const { parent_id, name } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath || !name?.trim()) throw makeError('name required and db must be open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const pid = parent_id ?? null
  const { m } = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM lore_nodes WHERE parent_id IS ?')
    .get(pid) as { m: number }
  const info = db
    .prepare('INSERT INTO lore_nodes (parent_id, name, position) VALUES (?, ?, ?)')
    .run(pid, name.trim(), m + 1)
  db.close()
  return { id: info.lastInsertRowid }
}

export function reorderLoreChildren(child_ids: number[]): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Array.isArray(child_ids)) throw makeError('child_ids must be an array', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const update = db.prepare('UPDATE lore_nodes SET position = ? WHERE id = ?')
  db.transaction(() => { child_ids.forEach((id, i) => update.run(i, id)) })()
  db.close()
  return { ok: true }
}

export function getLoreNode(id: number): LoreNodeRow {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath, { readonly: true })
  const node = db.prepare('SELECT * FROM lore_nodes WHERE id = ?').get(id)
  db.close()
  if (!node) throw makeError('node not found', 404)
  return node as LoreNodeRow
}

export function patchLoreNode(
  id: number,
  data: {
    name?: string
    content?: string
    prompt?: string
    start_review?: boolean
    accept_review?: boolean
    user_prompt?: string | null
    system_prompt?: string | null
    ai_settings?: string | null
  }
): {
  ok: boolean
  word_count?: number | null
  char_count?: number | null
  byte_count?: number | null
  ai_sync_info?: Record<string, Record<string, unknown>> | null
} {
  const { name, content, prompt, start_review, accept_review, user_prompt, system_prompt, ai_settings } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const hasName = typeof name === 'string' && name.trim().length > 0
  const hasContent = content !== undefined
  const hasUserPrompt = user_prompt !== undefined
  const hasSystemPrompt = system_prompt !== undefined
  const hasAiSettings = ai_settings !== undefined
  const hasStartReview = start_review === true
  const hasAcceptReview = accept_review === true
  if (!hasName && !hasContent && !hasUserPrompt && !hasSystemPrompt && !hasAiSettings && prompt === undefined && !hasStartReview && !hasAcceptReview) {
    throw makeError('name or content required', 400)
  }

  const db = new Database(dbPath)
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (hasName) { sets.push('name = ?'); params.push(name.trim()) }
  const wordCount = hasContent ? countWords(content) : null
  const charCount = hasContent ? countChars(content) : null
  const byteCount = hasContent ? countBytes(content) : null
  let updatedSyncInfo: Record<string, Record<string, unknown>> | null = null
  if (hasContent) {
    sets.push('content = ?'); params.push(content)
    sets.push('word_count = ?');  params.push(wordCount)
    sets.push('char_count = ?');  params.push(charCount)
    sets.push('byte_count = ?');  params.push(byteCount)
    const now = new Date().toISOString()
    const existingRow = db
      .prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = ?')
      .get(id) as { ai_sync_info: string | null } | undefined
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

  if (hasUserPrompt) {
    sets.push('user_prompt = ?'); params.push(user_prompt ?? null)
  }

  if (hasSystemPrompt) {
    sets.push('system_prompt = ?'); params.push(system_prompt ?? null)
  }

  if (hasAiSettings) {
    sets.push('ai_settings = ?'); params.push(ai_settings ?? null)
  }

  if (prompt !== undefined && !start_review) {
    sets.push('last_improve_instruction = ?'); params.push(prompt ?? null)
  }

  if (start_review && hasContent) {
    const cur = db
      .prepare('SELECT content, changes_status FROM lore_nodes WHERE id = ?')
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
    db.prepare(`UPDATE lore_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
  }
  db.close()
  return hasContent
    ? { ok: true, word_count: wordCount, char_count: charCount, byte_count: byteCount, ai_sync_info: updatedSyncInfo }
    : { ok: true }
}

export function deleteLoreNode(id: number): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const node = db
    .prepare('SELECT parent_id FROM lore_nodes WHERE id = ?')
    .get(id) as { parent_id: number | null } | undefined
  if (!node) { db.close(); throw makeError('node not found', 404) }
  if (node.parent_id === null) {
    db.close()
    throw makeError('root node cannot be deleted', 403)
  }
  db.prepare(`
    WITH RECURSIVE sub AS (
      SELECT id FROM lore_nodes WHERE id = ?
      UNION ALL
      SELECT n.id FROM lore_nodes n INNER JOIN sub s ON n.parent_id = s.id
    )
    UPDATE lore_nodes SET to_be_deleted = 1 WHERE id IN (SELECT id FROM sub)
  `).run(id)
  db.close()
  return { ok: true }
}

export function restoreLoreNode(id: number): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  db.prepare(`
    WITH RECURSIVE sub AS (
      SELECT id FROM lore_nodes WHERE id = ?
      UNION ALL
      SELECT n.id FROM lore_nodes n INNER JOIN sub s ON n.parent_id = s.id
    )
    UPDATE lore_nodes SET to_be_deleted = 0 WHERE id IN (SELECT id FROM sub)
  `).run(id)
  db.close()
  return { ok: true }
}

export function sortLoreChildren(id: number): { ok: boolean; sorted: number } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const children = db
    .prepare('SELECT id FROM lore_nodes WHERE parent_id = ? ORDER BY name COLLATE NOCASE ASC')
    .all(id) as { id: number }[]
  const update = db.prepare('UPDATE lore_nodes SET position = ? WHERE id = ?')
  db.transaction(() => { children.forEach((c, i) => update.run(i, c.id)) })()
  db.close()
  return { ok: true, sorted: children.length }
}

export function moveLoreNode(id: number, data: { parent_id?: number | null }): { ok: boolean } {
  const { parent_id } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const nodeId = Number(id)
  const newParentId = parent_id ?? null

  const node = db
    .prepare('SELECT parent_id, to_be_deleted FROM lore_nodes WHERE id = ?')
    .get(nodeId) as { parent_id: number | null; to_be_deleted: number } | undefined
  if (!node) { db.close(); throw makeError('node not found', 404) }
  if (node.parent_id === null) { db.close(); throw makeError('root node cannot be moved', 403) }

  if (newParentId === nodeId) { db.close(); throw makeError('cannot move node to itself', 400) }

  if (newParentId !== null) {
    const target = db
      .prepare('SELECT id, to_be_deleted FROM lore_nodes WHERE id = ?')
      .get(newParentId) as { id: number; to_be_deleted: number } | undefined
    if (!target) { db.close(); throw makeError('target parent does not exist', 400) }
    if (target.to_be_deleted && !node.to_be_deleted) {
      db.close()
      throw makeError('cannot move active node into a node marked for deletion', 400)
    }
  }

  if (newParentId !== null) {
    const getParent = db.prepare('SELECT parent_id FROM lore_nodes WHERE id = ?')
    let cur: number | null = newParentId
    while (cur !== null) {
      if (cur === nodeId) {
        db.close()
        throw makeError('cannot move node into its own descendant', 400)
      }
      cur = (getParent.get(cur) as { parent_id: number | null } | undefined)?.parent_id ?? null
    }
  }

  db.prepare('UPDATE lore_nodes SET parent_id = ? WHERE id = ?').run(newParentId, nodeId)
  db.close()
  return { ok: true }
}

export function duplicateLoreNode(id: number): { id: number | bigint } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const src = db
    .prepare('SELECT parent_id, name, content FROM lore_nodes WHERE id = ?')
    .get(id) as { parent_id: number | null; name: string; content: string | null } | undefined
  if (!src) { db.close(); throw makeError('node not found', 404) }

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
  return { id: info.lastInsertRowid }
}

// Keep fs import used only by older callers; unused here but kept for compat
void fs
