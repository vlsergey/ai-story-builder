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
  const service = new PlanNodeService()

  // Handle start_review
  if (data.start_review) {
    service.startReview(id, {
      prompt: data.prompt,
      content: data.content,
    })
    // If start_review is true, we still may want to apply other fields (like title, x, y, etc.)
    // But note that content may have been updated via startReview, so we should not pass content again.
    // We'll create a copy of data without review-specific fields and pass to patch.
  }

  // Handle accept_review
  if (data.accept_review) {
    service.acceptReview(id)
  }

  // Prepare data for generic patch (excluding review fields)
  const { prompt: _, start_review: __, accept_review: ___, ...patchData } = data
  // Map prompt to last_improve_instruction if present and not already handled by start_review
  if (data.prompt !== undefined && !data.start_review) {
    (patchData as any).last_improve_instruction = data.prompt
  }

  // Validate that there's something to patch (excluding review fields)
  const hasTitle = typeof patchData.title === 'string' && patchData.title.trim().length > 0
  const hasContent = patchData.content !== undefined
  const hasPosition = patchData.x !== undefined || patchData.y !== undefined
  const hasType = patchData.type !== undefined
  const hasUserPrompt = patchData.user_prompt !== undefined
  const hasSystemPrompt = patchData.system_prompt !== undefined
  const hasSummary = patchData.summary !== undefined
  const hasAutoSummary = patchData.auto_summary !== undefined
  const hasNodeTypeSettings = patchData.node_type_settings !== undefined
  const hasLastImproveInstruction = (patchData as any).last_improve_instruction !== undefined

  if (!hasTitle && !hasContent && !hasPosition && !hasType && !hasUserPrompt &&
      !hasSystemPrompt && !hasSummary && !hasAutoSummary && !hasNodeTypeSettings && !hasLastImproveInstruction) {
    // If no fields left to patch, but we already performed review actions, return success
    if (data.start_review || data.accept_review) {
      return { ok: true }
    }
    throw makeError('at least one field required', 400)
  }

  // Validate type if provided
  if (hasType && !isValidNodeType(patchData.type!)) {
    const valid = NODE_TYPES.map(nt => nt.id).join(', ')
    throw makeError(`Invalid node type "${patchData.type}". Valid types: ${valid}`, 400)
  }

  return service.patch(id, patchData as PlanNodeUpdate)
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
