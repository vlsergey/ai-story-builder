import type { PlanNodeRow, PlanEdgeRow } from '../types/index.js'
import { getCurrentDbPath } from '../db/state.js'
import type { PlanGraphData } from '../../shared/plan-graph.js'
import { generateMergeContent } from './merge-node.js'
import { isValidNodeType, isValidEdgeType, canCreateEdge, getEdgeTypeDefinition, EDGE_TYPES, NODE_TYPES } from '../../shared/node-edge-dictionary.js'

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

function makeEdgeTypeError(type: string): Error {
  const valid = EDGE_TYPES.map(et => et.id).join(', ')
  return makeError(`Invalid edge type "${type}". Valid types: ${valid}`, 400)
}

function makeEdgeCompatibilityError(sourceType: string, targetType: string, edgeType: string): Error {
  const edgeDef = getEdgeTypeDefinition(edgeType as any)
  if (edgeDef) {
    const allowedSource = edgeDef.allowedSourceNodeTypes.join(', ')
    const allowedTarget = edgeDef.allowedTargetNodeTypes.join(', ')
    return makeError(
      `Edge type "${edgeType}" not allowed between source node type "${sourceType}" and target node type "${targetType}". Allowed source types: ${allowedSource}. Allowed target types: ${allowedTarget}.`,
      400
    )
  }
  return makeError(`Edge type "${edgeType}" not allowed between node types "${sourceType}" and "${targetType}".`, 400)
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

export function getPlanGraph(): PlanGraphData {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath, { readonly: true })
  const nodes = db.prepare(
    `SELECT id, type, title, content, user_prompt, system_prompt, summary, auto_summary,
            ai_sync_info, x, y, word_count, char_count, byte_count,
            changes_status, review_base_content, last_improve_instruction,
            created_at
     FROM plan_nodes ORDER BY id`
  ).all() as PlanNodeRow[]
  const edges = db.prepare(
    `SELECT id, from_node_id, to_node_id, type, position, label, template
     FROM plan_edges ORDER BY position, id`
  ).all() as PlanEdgeRow[]
  db.close()
  return { nodes, edges } as PlanGraphData
}

export function createGraphNode(data: {
  type?: string
  title?: string
  x?: number
  y?: number
  user_prompt?: string
  system_prompt?: string
}): { id: number | bigint } {
  const { type = 'text', title, x = 0, y = 0, user_prompt, system_prompt } = data
  if (!isValidNodeType(type)) {
    throw makeNodeTypeError(type)
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !title) throw makeError('title required, db must be open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const info = db
    .prepare(
      `INSERT INTO plan_nodes (type, title, x, y, user_prompt, system_prompt, word_count, char_count, byte_count)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`
    )
    .run(type, title, x, y, user_prompt ?? null, system_prompt ?? null)
  db.close()
  return { id: info.lastInsertRowid }
}

export function getGraphNode(id: number): PlanNodeRow {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath, { readonly: true })
  const node = db.prepare('SELECT * FROM plan_nodes WHERE id = ?').get(id)
  db.close()
  if (!node) throw makeError('node not found', 404)
  return node as PlanNodeRow
}

export function patchGraphNode(
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
    throw makeNodeTypeError(type!)
  }

  if (!hasTitle && !hasContent && !hasPosition && !hasType && !hasUserPrompt &&
      !hasSystemPrompt && !hasSummary && !hasAutoSummary && !hasNodeTypeSettings && !accept_review &&
      prompt === undefined) {
    throw makeError('at least one field required', 400)
  }

  const db = new Database(dbPath)

  // Fetch current node for merge generation
  const current = db.prepare('SELECT type, node_type_settings, title FROM plan_nodes WHERE id = ?').get(id) as { type: string, node_type_settings: string | null, title: string } | undefined;
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

export function deleteGraphNode(id: number): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const node = db.prepare('SELECT id FROM plan_nodes WHERE id = ?').get(id)
  if (!node) { db.close(); throw makeError('node not found', 404) }
  // Delete connected edges first
  db.prepare('DELETE FROM plan_edges WHERE from_node_id = ? OR to_node_id = ?').run(id, id)
  // Delete the node
  db.prepare('DELETE FROM plan_nodes WHERE id = ?').run(id)
  db.close()
  return { ok: true }
}

export function createGraphEdge(data: {
  from_node_id?: number
  to_node_id?: number
  type?: string
  position?: number
  label?: string
  template?: string
}): { id: number | bigint } {
  const { from_node_id, to_node_id, type = 'text', position = 0, label, template } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (from_node_id == null || to_node_id == null) {
    throw makeError('from_node_id and to_node_id required', 400)
  }
  if (!Database) throw makeError('SQLite lib missing', 500)

  // Validate edge type
  if (type && !isValidEdgeType(type)) {
    throw makeEdgeTypeError(type)
  }

  const db = new Database(dbPath)
  // Fetch source and target node types
  const sourceNode = db.prepare('SELECT type FROM plan_nodes WHERE id = ?').get(from_node_id) as { type: string } | undefined
  const targetNode = db.prepare('SELECT type FROM plan_nodes WHERE id = ?').get(to_node_id) as { type: string } | undefined
  if (!sourceNode || !targetNode) {
    db.close()
    throw makeError('source or target node not found', 404)
  }

  // Validate compatibility
  if (!canCreateEdge(sourceNode.type as any, targetNode.type as any, type as any)) {
    db.close()
    throw makeEdgeCompatibilityError(sourceNode.type, targetNode.type, type)
  }

  const info = db
    .prepare(
      `INSERT INTO plan_edges (from_node_id, to_node_id, type, position, label, template)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(from_node_id, to_node_id, type, position, label ?? null, template ?? null)
  db.close()
  return { id: info.lastInsertRowid }
}

export function patchGraphEdge(
  id: number,
  data: { type?: string; position?: number; label?: string; template?: string }
): { ok: boolean } {
  const { type, position, label, template } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)

  // First get the current edge to access from_node_id and to_node_id
  const readDb = new Database(dbPath, { readonly: true })
  const currentEdge = readDb.prepare('SELECT from_node_id, to_node_id, type FROM plan_edges WHERE id = ?').get(id) as
    | { from_node_id: number; to_node_id: number; type: string }
    | undefined
  readDb.close()

  if (!currentEdge) {
    throw makeError('edge not found', 404)
  }

  // Validate edge type if provided
  if (type !== undefined) {
    if (!isValidEdgeType(type)) {
      throw makeEdgeTypeError(type)
    }
    // Fetch source and target node types
    const db = new Database(dbPath)
    const sourceNode = db.prepare('SELECT type FROM plan_nodes WHERE id = ?').get(currentEdge.from_node_id) as { type: string } | undefined
    const targetNode = db.prepare('SELECT type FROM plan_nodes WHERE id = ?').get(currentEdge.to_node_id) as { type: string } | undefined
    db.close()
    if (!sourceNode || !targetNode) {
      throw makeError('source or target node not found', 404)
    }
    if (!canCreateEdge(sourceNode.type as any, targetNode.type as any, type as any)) {
      throw makeEdgeCompatibilityError(sourceNode.type, targetNode.type, type)
    }
  }

  if (type == null && position == null && label === undefined && template === undefined) {
    throw makeError('at least one field required', 400)
  }

  const db = new Database(dbPath)
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (type !== undefined) { sets.push('type = ?'); params.push(type) }
  if (position !== undefined) { sets.push('position = ?'); params.push(position) }
  if (label !== undefined) { sets.push('label = ?'); params.push(label ?? null) }
  if (template !== undefined) { sets.push('template = ?'); params.push(template ?? null) }
  if (sets.length > 0) {
    db.prepare(`UPDATE plan_edges SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
  }
  db.close()
  return { ok: true }
}

export function deleteGraphEdge(id: number): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const edge = db.prepare('SELECT id FROM plan_edges WHERE id = ?').get(id)
  if (!edge) { db.close(); throw makeError('edge not found', 404) }
  db.prepare('DELETE FROM plan_edges WHERE id = ?').run(id)
  db.close()
  return { ok: true }
}
