/** Event fired to open a plan node editor panel. */
export const OPEN_PLAN_NODE_EDITOR_EVENT = 'open-plan-node-editor'

export interface OpenPlanNodeEditorDetail {
  nodeId: number
}

/** Dispatch an event to open the plan node editor for the given node. */
export function dispatchOpenPlanNodeEditor(nodeId: number): void {
  window.dispatchEvent(
    new CustomEvent<OpenPlanNodeEditorDetail>(OPEN_PLAN_NODE_EDITOR_EVENT, { detail: { nodeId } })
  )
}
