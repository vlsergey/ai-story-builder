import { PlanNodeRow } from "@shared/plan-graph"

/** Event fired to open a plan node editor panel. */
export const OPEN_PLAN_NODE_EDITOR_EVENT = "open-plan-node-editor"

export interface OpenPlanNodeEditorDetail {
  node: PlanNodeRow
}

/** Dispatch an event to open the plan node editor for the given node. */
export function dispatchOpenPlanNodeEditor(node: PlanNodeRow): void {
  window.dispatchEvent(new CustomEvent<OpenPlanNodeEditorDetail>(OPEN_PLAN_NODE_EDITOR_EVENT, { detail: { node } }))
}
