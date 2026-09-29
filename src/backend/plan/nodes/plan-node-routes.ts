import type { PlanNodeRow } from "../../../shared/plan-graph.js"
import type { NodePath } from "../../../shared/plan-node-path.js"
import { regenerateTreeNodesContents } from "./generate/regenerateTreeNodesContents.js"
import { PlanNodeService } from "./plan-node-service.js"

/** Regenerates the node at `path` and opens a review of what changed. */
export async function aiGenerateAndReview(id: number, path: NodePath): Promise<PlanNodeRow> {
  return new PlanNodeService().regenerateForReview(id, path, (target) => regenerateTreeNodesContents(target))
}
