import type { PlanNodeTree } from '../../types/index'
import type { PlanNodeCreate, PlanNodeRow, PlanNodeUpdate } from '../../../shared/plan-graph'
import { isValidNodeType, NODE_TYPES } from '../../../shared/node-edge-dictionary'
import { PlanNodeService } from './plan-node-service'
import { PlanEdgeRepository } from '../edges/plan-edge-repository.js'

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

export function patchPlanNode(
  id: number,
  data: PlanNodeUpdate
): { ok: boolean; word_count?: number | null; char_count?: number | null; byte_count?: number | null } {
  // Validate that there's at least one field to update
  const hasAnyField = Object.keys(data).some(key => data[key as keyof PlanNodeUpdate] !== undefined)
  if (!hasAnyField) {
    throw makeError('at least one field required', 400)
  }

  // Validate type if provided
  if (data.type !== undefined && !isValidNodeType(data.type)) {
    const valid = NODE_TYPES.map(nt => nt.id).join(', ')
    throw makeError(`Invalid node type "${data.type}". Valid types: ${valid}`, 400)
  }

  const service = new PlanNodeService()
  return service.patch(id, data)
}

export function startPlanNodeReview(
  id: number,
  options?: { prompt?: string; content?: string }
): { ok: boolean } {
  const service = new PlanNodeService()
  service.startReview(id, options)
  return { ok: true }
}

export function acceptPlanNodeReview(id: number): { ok: boolean } {
  const service = new PlanNodeService()
  service.acceptReview(id)
  return { ok: true }
}

export function deletePlanNode(id: number): { ok: boolean } {
  // Delete connected edges first
  new PlanEdgeRepository().deleteByNodeId(id)
  // Delete the node via service (will throw if node not found)
  return new PlanNodeService().delete(id)
}

export function movePlanNode(id: number, data: { parent_id?: number | null }): { ok: boolean } {
  const { parent_id } = data
  return new PlanNodeService().move(id, parent_id ?? null)
}

export function reorderPlanChildren(child_ids: number[]): { ok: boolean } {
  if (!Array.isArray(child_ids)) throw makeError('child_ids must be an array', 400)
  return new PlanNodeService().reorderChildren(child_ids)
}
