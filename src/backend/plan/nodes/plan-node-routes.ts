import { isValidNodeType, NODE_TYPES } from "../../../shared/node-edge-dictionary.js"
import type { PlanNodeCreate } from "../../../shared/plan-graph.js"
import { makeErrorWithStatus } from "../../lib/make-errors.js"
import { regenerateTreeNodesContents } from "./generate/regenerateTreeNodesContents.js"
import { PlanNodeService } from "./plan-node-service.js"

export async function aiGenerateAndReview(nodeId: number) {
  const service = new PlanNodeService()
  const oldNode = service.getById(nodeId)

  await regenerateTreeNodesContents(nodeId)
  const regenerated = service.getById(nodeId)
  const newNode = await service.patch(nodeId, false, {
    in_review: (regenerated.content?.trim()?.length || 0) > 0 ? 1 : 0,
    review_base_content: oldNode.content,
  })
  return newNode
}

export function createPlanNode(data: PlanNodeCreate): { id: number | bigint } {
  if (!data.title) throw makeErrorWithStatus("title required", 400)
  // Validate type if provided
  if (data.type !== undefined && !isValidNodeType(data.type)) {
    const valid = NODE_TYPES.map((nt) => nt.id).join(", ")
    throw makeErrorWithStatus(`Invalid node type "${data.type}". Valid types: ${valid}`, 400)
  }

  const result = new PlanNodeService().create(data)
  return { id: result.id }
}
