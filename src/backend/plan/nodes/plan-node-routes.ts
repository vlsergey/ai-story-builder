import type { PlanNodeTree } from '../../types/index.js'
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

export function getPlanNodes(): PlanNodeTree[] {
  const nodes = new PlanNodeService().getAll()

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
