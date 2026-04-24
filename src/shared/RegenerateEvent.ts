import type { PlanNodeRow } from "./plan-graph.js"

export interface RegenerationStackItemIteration {
  type: "iteration"
  container: PlanNodeRow
  zeroBasedIterationIndex: number
  totalIterations?: number
}

export interface RegenerationStackItemNode {
  type: "node"
  node: PlanNodeRow
}

export type RegenerationStackItem = RegenerationStackItemIteration | RegenerationStackItemNode

export interface RegenerateStatusEvent {
  inProcess: boolean
  stopping: boolean

  currentRegenerationStack: RegenerationStackItem[]
  firstError?: unknown

  generatedNew: number
  generatedSame: number
  generatedEmpty: number
  skipped: number
}
