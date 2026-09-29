import type { PlanNodeDefinition } from "@shared/plan-graph"
import type { NodePath } from "@shared/plan-node-path"

/** Event fired to open a plan node editor panel. */
export const OPEN_PLAN_NODE_EDITOR_EVENT = "open-plan-node-editor"

export interface OpenPlanNodeEditorDetail {
  node: Pick<PlanNodeDefinition, "id" | "title">
  /** The iteration to edit the node in; `''` outside loops. */
  path: NodePath
}

/** Dispatch an event to open the plan node editor for the node in one iteration. */
export function dispatchOpenPlanNodeEditor(node: Pick<PlanNodeDefinition, "id" | "title">, path: NodePath): void {
  window.dispatchEvent(
    new CustomEvent<OpenPlanNodeEditorDetail>(OPEN_PLAN_NODE_EDITOR_EVENT, { detail: { node, path } }),
  )
}
