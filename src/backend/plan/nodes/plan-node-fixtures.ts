import type { PlanNodeStateUpdate, PlanNodeStatus } from "../../../shared/plan-graph.js"
import type { NodePath } from "../../../shared/plan-node-path.js"
import type { PlanNodeType } from "../../../shared/plan-node-types.js"
import { PlanEdgeRepository } from "../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { type PlanNodeStateRecord, PlanNodeStateRepository } from "./plan-node-state-repository.js"

/**
 * Test fixtures: plan nodes as an earlier run left them, written straight to
 * storage — for tests below the service, which must not depend on how it
 * would have produced that state.
 */

export interface SeededNode {
  title: string
  type?: PlanNodeType
  parent?: number | null
  /** `node_type_settings`, as JSON. */
  settings?: string | null
  /** Its state in each iteration, by path; outside loops that is `''`. A path left out: it never ran there. */
  at?: Record<NodePath, PlanNodeStatus | PlanNodeStateUpdate>
}

export function seedNode(spec: SeededNode): number {
  const id = new PlanNodeRepository().insert({
    title: spec.title,
    type: spec.type ?? "text",
    parent_id: spec.parent ?? null,
    node_type_settings: spec.settings ?? null,
  })
  for (const [path, state] of Object.entries(spec.at ?? {})) {
    new PlanNodeStateRepository().upsert(id, path, typeof state === "string" ? { status: state } : state)
  }
  return id
}

/** Adds or replaces the node's state at `path`. */
export function seedState(nodeId: number, path: NodePath, state: PlanNodeStatus | PlanNodeStateUpdate): void {
  new PlanNodeStateRepository().upsert(nodeId, path, typeof state === "string" ? { status: state } : state)
}

export function seedEdge(from: number, to: number, type: "text" | "textArray" = "text"): void {
  new PlanEdgeRepository().insert({ from_node_id: from, to_node_id: to, type })
}

/** The node's stored state at `path`; undefined if it never ran there. */
export function stateAt(nodeId: number, path: NodePath = ""): PlanNodeStateRecord | undefined {
  return new PlanNodeStateRepository().find(nodeId, path)
}
