import {
  canCreateEdge,
  EDGE_TYPES_DEFS,
  getEdgeTypeDefinition,
  isValidEdgeType,
} from "../../../shared/node-edge-dictionary.js"
import type { PlanEdgeType } from "../../../shared/plan-edge-types.js"
import { PlanNodeRepository } from "../nodes/plan-node-repository.js"
import { planEdgeEventManager } from "./plan-edge-event-manager.js"
import { PlanEdgeRepository } from "./plan-edge-repository.js"

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

function makeEdgeTypeError(type: string): Error {
  const valid = EDGE_TYPES_DEFS.map((et) => et.id).join(", ")
  return makeError(`Invalid edge type "${type}". Valid types: ${valid}`, 400)
}

function makeEdgeCompatibilityError(sourceType: string, targetType: string, edgeType: string): Error {
  const edgeDef = getEdgeTypeDefinition(edgeType as any)
  if (edgeDef) {
    const allowedSource = edgeDef.allowedSourceNodeTypes.join(", ")
    const allowedTarget = edgeDef.allowedTargetNodeTypes.join(", ")
    return makeError(
      `Edge type "${edgeType}" not allowed between source node type "${sourceType}" and target node type "${targetType}". Allowed source types: ${allowedSource}. Allowed target types: ${allowedTarget}.`,
      400,
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
  const { from_node_id, to_node_id, type = "text", position = 0, label, template } = data
  if (from_node_id == null || to_node_id == null) {
    throw makeError("from_node_id and to_node_id required", 400)
  }

  // Validate edge type
  if (type && !isValidEdgeType(type)) {
    throw makeEdgeTypeError(type)
  }

  const nodeRepo = new PlanNodeRepository()
  const sourceNode = nodeRepo.findById(from_node_id)
  const targetNode = nodeRepo.findById(to_node_id)
  if (!sourceNode || !targetNode) {
    throw makeError("source or target node not found", 404)
  }

  // Validate compatibility
  if (!canCreateEdge(sourceNode.type as any, targetNode.type as any, type as any)) {
    throw makeEdgeCompatibilityError(sourceNode.type, targetNode.type, type)
  }

  const edgeRepo = new PlanEdgeRepository()
  const edgeType: PlanEdgeType = type as PlanEdgeType
  const id = edgeRepo.insert({
    from_node_id,
    to_node_id,
    type: edgeType,
    position,
    label: label ?? null,
    template: template ?? null,
  })
  planEdgeEventManager.emitUpdate(Number(id))
  return { id }
}

export function patchGraphEdge(
  id: number,
  data: { type?: string; position?: number; label?: string; template?: string },
): { ok: boolean } {
  const { type, position, label, template } = data
  const edgeRepo = new PlanEdgeRepository()
  const currentEdge = edgeRepo.getById(id)
  if (!currentEdge) {
    throw makeError("edge not found", 404)
  }

  // Validate edge type if provided
  if (type !== undefined) {
    if (!isValidEdgeType(type)) {
      throw makeEdgeTypeError(type)
    }
    const nodeRepo = new PlanNodeRepository()
    const sourceNode = nodeRepo.findById(currentEdge.from_node_id)
    const targetNode = nodeRepo.findById(currentEdge.to_node_id)
    if (!sourceNode || !targetNode) {
      throw makeError("source or target node not found", 404)
    }
    if (!canCreateEdge(sourceNode.type as any, targetNode.type as any, type as any)) {
      throw makeEdgeCompatibilityError(sourceNode.type, targetNode.type, type)
    }
  }

  if (type == null && position == null && label === undefined && template === undefined) {
    throw makeError("at least one field required", 400)
  }

  const updateFields: any = {}
  if (type !== undefined) updateFields.type = type as PlanEdgeType
  if (position !== undefined) updateFields.position = position
  if (label !== undefined) updateFields.label = label ?? null
  if (template !== undefined) updateFields.template = template ?? null

  edgeRepo.update(id, updateFields)
  planEdgeEventManager.emitUpdate(id)
  return { ok: true }
}

export function deleteGraphEdge(id: number): { ok: boolean } {
  const edgeRepo = new PlanEdgeRepository()
  const edge = edgeRepo.getById(id)
  if (!edge) {
    throw makeError("edge not found", 404)
  }
  edgeRepo.delete(id)
  planEdgeEventManager.emitUpdate(id)
  return { ok: true }
}
