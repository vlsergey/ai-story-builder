import type { PlanNodeRow } from "./plan-graph.js"
import type { NodePath } from "./plan-node-path.js"

/** A node as the progress panel names it: which node, and where it runs. Never its texts. */
export type RegenerationNodeRef = Pick<PlanNodeRow, "id" | "title" | "type" | "path">

export interface RegenerationStackItemIteration {
  type: "iteration"
  container: RegenerationNodeRef
  zeroBasedIterationIndex: number
  totalIterations?: number
  /** The iteration's key in its children's paths, when it is not the index — a parallel loop's hash. */
  key?: string
}

export interface RegenerationStackItemNode {
  type: "node"
  node: RegenerationNodeRef
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
