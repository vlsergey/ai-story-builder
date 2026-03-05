/** Event name fired by PlanEditor after a successful content save. */
export const PLAN_NODE_SAVED_EVENT = 'plan-node-saved'

export interface PlanNodeSavedDetail {
  id: number
  title?: string
  wordCount?: number
  charCount?: number
  byteCount?: number
}

/** Dispatch a plan-node-saved event on window so other panels can react. */
export function dispatchPlanNodeSaved(detail: PlanNodeSavedDetail): void {
  window.dispatchEvent(new CustomEvent<PlanNodeSavedDetail>(PLAN_NODE_SAVED_EVENT, { detail }))
}

/** Event fired to trigger a full plan tree reload. */
export const PLAN_TREE_REFRESH_EVENT = 'plan-tree-refresh'

/** Dispatch a plan-tree-refresh event. */
export function dispatchPlanTreeRefresh(): void {
  window.dispatchEvent(new Event(PLAN_TREE_REFRESH_EVENT))
}
