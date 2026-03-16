import type { PlanEdgeRow } from '../types/index.js'
import { getCurrentDbPath } from '../db/state.js'
import { isValidEdgeType, canCreateEdge, getEdgeTypeDefinition, EDGE_TYPES } from '../../shared/node-edge-dictionary.js'

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

// ── Edge functions ─────────────────────────────────────────────────────────────

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