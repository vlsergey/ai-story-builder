import type { PlanNodeRow, PlanEdgeRow, PlanNodeTree } from '../types/index.js'
import { getCurrentDbPath } from '../db/state.js'
import type { PlanGraphData } from '../../shared/plan-graph.js'

// Re‑export node functions
export {
  getPlanNodes,
  getPlanNode,
  createPlanNode,
  patchPlanNode,
  deletePlanNode,
  movePlanNode,
  reorderPlanChildren,
  createGraphNode,
  getGraphNode,
  patchGraphNode,
  deleteGraphNode,
} from './plan-graph-nodes.js'

// Re‑export edge functions
export {
  createGraphEdge,
  patchGraphEdge,
  deleteGraphEdge,
} from './plan-graph-edges.js'

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

// ── Graph‑level function ──────────────────────────────────────────────────────

export function getPlanGraph(): PlanGraphData {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath, { readonly: true })
  const nodes = db.prepare(
    `SELECT id, type, title, content, user_prompt, system_prompt, summary, auto_summary,
            ai_sync_info, x, y, word_count, char_count, byte_count,
            changes_status, review_base_content, last_improve_instruction,
            status, created_at
     FROM plan_nodes ORDER BY id`
  ).all() as PlanNodeRow[]
  const edges = db.prepare(
    `SELECT id, from_node_id, to_node_id, type, position, label, template
     FROM plan_edges ORDER BY position, id`
  ).all() as PlanEdgeRow[]
  db.close()
  return { nodes, edges } as PlanGraphData
}
