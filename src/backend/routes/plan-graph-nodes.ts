
import type { PlanNodeRow, PlanNodeTree } from '../types/index.js'
import { getCurrentDbPath } from '../db/state.js'
import { generateMergeContent } from './merge-node.js'
import { isValidNodeType, NODE_TYPES } from '../../shared/node-edge-dictionary.js'

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

function makeNodeTypeError(type: string): Error {
  const valid = NODE_TYPES.map(nt => nt.id).join(', ')
  return makeError(`Invalid node type "${type}". Valid types: ${valid}`, 400)
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

// ── Plan node functions ──────────────────────────────────────────────────────

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
  type?: string
  x?: number
  y?: number
  user_prompt?: string
  system_prompt?: string
  summary?: string
  auto_summary?: number
  ai_sync_info?: string
  node_type_settings?: string
}): { id: number | bigint } {
  const {
    parent_id,
    title,
    position,
    content,
    type = 'text',
    x = 0,
    y = 0,
    user_prompt,
    system_prompt,
    summary,
    auto_summary = 0,
    ai_sync_info,
    node_type_settings,
  } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath || !title) throw makeError('title required, db must be open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)

  // Validate node type
  if (!isValidNodeType(type)) {
    const valid = ['text', 'lore', 'merge', 'split'].join(', ')
    throw makeError(`Invalid node type "${type}". Valid types: ${valid}`, 400)
  }

  const db = new Database(dbPath)
  const pid = parent_id ?? null
  const { m } = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM plan_nodes WHERE parent_id IS ?')
    .get(pid) as { m: number }
  let wordCount = 0, charCount = 0, byteCount = 0
  let status: string = 'EMPTY'
  if (content) {
    wordCount = countWords(content)
    charCount = countChars(content)
    byteCount = countBytes(content)
    // If content is not empty, set status to MANUAL (user-provided)
    status = 'MANUAL'
  }
  const info = db
    .prepare(`
      INSERT INTO plan_nodes (
        parent_id, title, position, content,
        type, x, y, user_prompt, system_prompt,
        summary, auto_summary, ai_sync_info, node_type_settings,
        word_count, char_count, byte_count, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      pid,
      title,
      position ?? m + 1,
      content ?? null,
      type,
      x,
      y,
      user_prompt ?? null,
      system_prompt ?? null,
      summary ?? null,
      auto_summary,
      ai_sync_info ?? null,
      node_type_settings ?? null,
      wordCount,
      charCount,
      byteCount,
      status
    )
  db.close()
  return { id: info.lastInsertRowid }
}

export function patchPlanNode(
  id: number,
  data: {
    title?: string
    content?: string
    x?: number
    y?: number
    type?: string
    user_prompt?: string
    system_prompt?: string
    summary?: string
    auto_summary?: number
    node_type_settings?: string
    prompt?: string
    start_review?: boolean
    accept_review?: boolean
  }
): { ok: boolean; word_count?: number | null; char_count?: number | null; byte_count?: number | null } {
  const {
    title, content, x, y, type,
    user_prompt, system_prompt, summary, auto_summary, node_type_settings,
    prompt, start_review, accept_review,
  } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)

  const hasTitle = typeof title === 'string' && title.trim().length > 0
  const hasContent = content !== undefined
  const hasPosition = x !== undefined || y !== undefined
  const hasType = type !== undefined
  const hasUserPrompt = user_prompt !== undefined
  const hasSystemPrompt = system_prompt !== undefined
  const hasSummary = summary !== undefined
  const hasAutoSummary = auto_summary !== undefined
  const hasNodeTypeSettings = node_type_settings !== undefined

  // Validate type if provided
  if (hasType && !isValidNodeType(type!)) {
    const valid = NODE_TYPES.map(nt => nt.id).join(', ')
    throw makeError(`Invalid node type "${type}". Valid types: ${valid}`, 400)
  }

  if (!hasTitle && !hasContent && !hasPosition && !hasType && !hasUserPrompt &&
      !hasSystemPrompt && !hasSummary && !hasAutoSummary && !hasNodeTypeSettings && !accept_review &&
      prompt === undefined) {
    throw makeError('at least one field required', 400)
  }

  const db = new Database(dbPath)

  // Fetch current node for merge generation and status
  const current = db.prepare('SELECT type, node_type_settings, title, status FROM plan_nodes WHERE id = ?').get(id) as { type: string, node_type_settings: string | null, title: string, status: string } | undefined;
  if (!current) {
    db.close();
    throw makeError('node not found', 404);
  }
  const willBeMerge = (hasType && type === 'merge') || (!hasType && current.type === 'merge');
  let generatedContent: string | null = null;
  let generatedWordCount: number | null = null;
  let generatedCharCount: number | null = null;
  let generatedByteCount: number | null = null;

  // Determine if we should regenerate merge content
  if (willBeMerge && !hasContent && (hasNodeTypeSettings || (hasType && type === 'merge'))) {
    // Parse settings
    const defaultSettings = {
      includeNodeTitle: false,
      includeInputTitles: false,
      fixHeaders: false,
      autoUpdate: false,
    };
    let settings = defaultSettings;
    if (hasNodeTypeSettings) {
      try {
        settings = { ...defaultSettings, ...JSON.parse(node_type_settings!) };
      } catch (e) {
        // keep defaults
      }
    } else if (current.node_type_settings) {
      try {
        settings = { ...defaultSettings, ...JSON.parse(current.node_type_settings) };
      } catch (e) {
        // keep defaults
      }
    }
    const nodeTitle = hasTitle ? title!.trim() : current.title;
    try {
      generatedContent = generateMergeContent(db, id, settings, nodeTitle);
      generatedWordCount = countWords(generatedContent);
      generatedCharCount = countChars(generatedContent);
      generatedByteCount = countBytes(generatedContent);
    } catch (error) {
      // If generation fails (e.g., no inputs), leave content empty
      generatedContent = '';
      generatedWordCount = 0;
      generatedCharCount = 0;
      generatedByteCount = 0;
    }
  }

  // Determine new status
  let newStatus = current.status
  if (generatedContent !== null) {
    // Generated content (merge node regeneration) -> GENERATED
    newStatus = 'GENERATED'
  } else if (hasContent) {
    // User-provided content
    if (content === null || content.trim() === '') {
      newStatus = 'EMPTY'
    } else {
      newStatus = 'MANUAL'
    }
  }
  // If status changed, add to update sets
  if (newStatus !== current.status) {
    // will be added later
  }

  const sets: string[] = []
  const params: (string | number | null)[] = []

  if (hasTitle) { sets.push('title = ?'); params.push(title!.trim()) }
  if (hasType) {
    sets.push('type = ?');
    params.push(type!);
    // If changing to merge type, ensure content is null (calculated)
    if (type === 'merge') {
      sets.push('content = ?');
      params.push(null);
    }
  }
  if (x !== undefined) { sets.push('x = ?'); params.push(x) }
  if (y !== undefined) { sets.push('y = ?'); params.push(y) }
  if (hasUserPrompt) { sets.push('user_prompt = ?'); params.push(user_prompt ?? null) }
  if (hasSystemPrompt) { sets.push('system_prompt = ?'); params.push(system_prompt ?? null) }
  if (hasSummary) { sets.push('summary = ?'); params.push(summary ?? null) }
  if (hasAutoSummary) { sets.push('auto_summary = ?'); params.push(auto_summary ?? 0) }
  if (hasNodeTypeSettings) { sets.push('node_type_settings = ?'); params.push(node_type_settings ?? null) }

  // Update status if changed
  if (newStatus !== current.status) {
    sets.push('status = ?');
    params.push(newStatus);
  }

  // Add generated merge content if any
  if (generatedContent !== null) {
    sets.push('content = ?'); params.push(generatedContent);
    sets.push('word_count = ?'); params.push(generatedWordCount!);
    sets.push('char_count = ?'); params.push(generatedCharCount!);
    sets.push('byte_count = ?'); params.push(generatedByteCount!);
  }

  const wordCount = hasContent ? countWords(content!) : null
  const charCount = hasContent ? countChars(content!) : null
  const byteCount = hasContent ? countBytes(content!) : null

  if (hasContent) {
    sets.push('content = ?'); params.push(content!)
    sets.push('word_count = ?'); params.push(wordCount!)
    sets.push('char_count = ?'); params.push(charCount!)
    sets.push('byte_count = ?'); params.push(byteCount!)
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
  const anyContent = hasContent || generatedContent !== null;
  const finalWordCount = hasContent ? wordCount : (generatedContent !== null ? generatedWordCount : null);
  const finalCharCount = hasContent ? charCount : (generatedContent !== null ? generatedCharCount : null);
  const finalByteCount = hasContent ? byteCount : (generatedContent !== null ? generatedByteCount : null);
  return anyContent
    ? { ok: true, word_count: finalWordCount, char_count: finalCharCount, byte_count: finalByteCount }
    : { ok: true }
}

export function deletePlanNode(id: number): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const node = db.prepare('SELECT id FROM plan_nodes WHERE id = ?').get(id)
  if (!node) { db.close(); throw makeError('node not found', 404) }
  // Delete connected edges first
  db.prepare('DELETE FROM plan_edges WHERE from_node_id = ? OR to_node_id = ?').run(id, id)
  // Delete the node (cascades to children via foreign key)
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

// ── Graph‑specific functions (ali
// ── Graph‑specific functions (aliases for compatibility) ──────────────────────

export const createGraphNode = createPlanNode
export const getGraphNode = getPlanNode
export const patchGraphNode = patchPlanNode
export const deleteGraphNode = deletePlanNode