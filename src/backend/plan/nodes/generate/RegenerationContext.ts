import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import type { NodePath } from "../../../../shared/plan-node-path.js"
import type { RegenerateOptions } from "../../../../shared/RegenerateOptions.js"

export type PlanNodeAiGenerationStatus = "EMPTY" | "SAME" | "GENERATED"

/**
 * One node being regenerated at one path. A loop does not run its children
 * from here: the run schedules each of them, in each iteration, on its own.
 */
export interface RegenerationNodeContext {
  abortSignal: AbortSignal
  nodeId: number
  path: NodePath
  options: RegenerateOptions
  onResponseStreamEvent(contentPath: (string | number)[], event: ResponseStreamEvent): void
  /** A node that tries more than once — fix-problems — reports its tries through this. */
  asCycle<T>(totalIterations: number | undefined, block: (context: RegenerationCycleContext) => Promise<T>): Promise<T>
}

/** The tries of one node: fix-problems looking for problems and fixing them, again and again. */
export interface RegenerationCycleContext {
  abortSignal: AbortSignal
  options: RegenerateOptions
  /** Runs one try, shown in the progress panel as the node's `zeroBasedIterationIndex`-th. */
  asNode<T>(zeroBasedIterationIndex: number, block: (context: RegenerationNodeContext) => Promise<T>): Promise<T>
}
