import type { PlanNodeRow } from "./plan-graph.js"
import type { NodePath } from "./plan-node-path.js"

export interface RegenerationStackItemIteration {
  type: "iteration"
  container: PlanNodeRow
  zeroBasedIterationIndex: number
  totalIterations?: number
  /** The iteration's key in its children's paths, when it is not the index — a parallel loop's hash. */
  key?: string
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
  /** The node that failed first, and the iteration it failed in. */
  firstErrorAt?: { nodeId: number; title: string; path: NodePath } | null

  generatedNew: number
  generatedSame: number
  generatedEmpty: number
  skipped: number
}
