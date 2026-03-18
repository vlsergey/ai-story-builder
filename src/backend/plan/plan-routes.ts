import type { PlanGraphData } from '../../shared/plan-graph.js'
import { PlanNodeRepository } from './nodes/plan-node-repository.js'
import { PlanEdgeRepository } from './edges/plan-edge-repository.js'

// Re‑export node functions
export {
  getPlanNodes,
  getPlanNode,
  createPlanNode,
  patchPlanNode,
  deletePlanNode,
  movePlanNode,
  reorderPlanChildren,
  startPlanNodeReview,
  acceptPlanNodeReview,
} from './nodes/plan-node-routes.js'

// Re‑export edge functions
export {
  createGraphEdge,
  patchGraphEdge,
  deleteGraphEdge,
} from './edges/plan-edge-routes.js'

// ── Graph‑level function ──────────────────────────────────────────────────────

export function getPlanGraph(): PlanGraphData {
  const nodes = new PlanNodeRepository().getAll()
  const edges = new PlanEdgeRepository().getAll()
  return { nodes, edges }
}
