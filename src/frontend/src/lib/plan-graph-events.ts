/** Event fired to trigger a full plan graph reload. */
export const PLAN_GRAPH_REFRESH_EVENT = 'plan-graph-refresh'

/** Event fired to open a plan node editor panel. */
export const OPEN_PLAN_NODE_EDITOR_EVENT = 'open-plan-node-editor'

export interface OpenPlanNodeEditorDetail {
  nodeId: number
}

/** Dispatch a plan-graph-refresh event. */
export function dispatchPlanGraphRefresh(): void {
  window.dispatchEvent(new Event(PLAN_GRAPH_REFRESH_EVENT))
}

/** Dispatch an event to open the plan node editor for the given node. */
export function dispatchOpenPlanNodeEditor(nodeId: number): void {
  window.dispatchEvent(
    new CustomEvent<OpenPlanNodeEditorDetail>(OPEN_PLAN_NODE_EDITOR_EVENT, { detail: { nodeId } })
  )
}
