import type { PlanNodeRow } from "./plan-graph.js"
import type { NodePath } from "./plan-node-path.js"

/** A node as the progress panel names it: which node, and where it runs. Never its texts. */
export type RegenerationNodeRef = Pick<PlanNodeRow, "id" | "title" | "type" | "path">

/**
 * A node being written now, in its iteration. The loops around it and the
 * iterations of theirs that run are read off its path.
 */
export interface RunningNode {
  node: RegenerationNodeRef
  /** A node that tries more than once — fix-problems: which try this is, from zero, of at most `total`. */
  attempt?: { index: number; total?: number }
}

/** A loop running its iterations, and how far it has got. */
export interface RunningLoop {
  node: RegenerationNodeRef
  /** Iterations done, of `total`. */
  done: number
  total: number
  /** The key of the earliest iteration not done yet: where a sequential loop is followed. */
  current: string
}

export interface RegenerateStatusEvent {
  inProcess: boolean
  stopping: boolean

  /** What is being written now, in the order it started. */
  running: RunningNode[]
  /** The loops whose iterations are being run. */
  loops: RunningLoop[]
  firstError?: unknown
  /** The node that failed first, and the iteration it failed in. */
  firstErrorAt?: { nodeId: number; title: string; path: NodePath } | null

  generatedNew: number
  generatedSame: number
  generatedEmpty: number
  skipped: number
}
