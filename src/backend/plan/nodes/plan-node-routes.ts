import type { PlanNodeCreate, PlanNodeRow } from '../../../shared/plan-graph.js'
import { isValidNodeType, NODE_TYPES } from '../../../shared/node-edge-dictionary.js'
import { PlanNodeService } from './plan-node-service.js'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

// ── Plan node functions ──────────────────────────────────────────────────────

export function getPlanNodes(): PlanNodeRow[] {
  const nodes = new PlanNodeService().getAll()
  // Возвращаем плоский список узлов без children
  return nodes
}

export function getPlanNode(id: number): PlanNodeRow {
  const node = new PlanNodeService().getById(id)
  if (!node) throw makeError('node not found', 404)
  return node
}

export function createPlanNode(data: PlanNodeCreate): { id: number | bigint } {
  if (!data.title) throw makeError('title required', 400)
  // Validate type if provided
  if (data.type !== undefined && !isValidNodeType(data.type)) {
    const valid = NODE_TYPES.map(nt => nt.id).join(', ')
    throw makeError(`Invalid node type "${data.type}". Valid types: ${valid}`, 400)
  }

  const result = new PlanNodeService().create(data)
  return { id: result.id }
}

