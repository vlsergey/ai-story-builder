import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import type { PlanNodeRow } from "../../../../shared/plan-graph.js"
import type { NodePath } from "../../../../shared/plan-node-path.js"
import type { RegenerateOptions } from "../../../../shared/RegenerateOptions.js"

export type PlanNodeAiGenerationStatus = "EMPTY" | "SAME" | "GENERATED"

/** One level of the graph being run: the top level at `''`, or one iteration of a loop. */
export interface RegenerationContainerContext {
  abortSignal: AbortSignal
  options: RegenerateOptions
  /** The iteration this level runs in. */
  path: NodePath
  onNodeSkip(node: PlanNodeRow, skipReason: string): void
  onNodeStart<T>(
    node: PlanNodeRow,
    block: (context: RegenerationNodeContext) => Promise<{ result: T; status: PlanNodeAiGenerationStatus }>,
  ): Promise<T>
}

/** One node being regenerated at one path. */
export interface RegenerationNodeContext {
  abortSignal: AbortSignal
  nodeId: number
  path: NodePath
  options: RegenerateOptions
  onResponseStreamEvent(contentPath: (string | number)[], event: ResponseStreamEvent): void
  asCycle<T>(totalIterations: number | undefined, block: (context: RegenerationCycleContext) => Promise<T>): Promise<T>
}

/** A node running iterations: a loop over its children, or fix-problems over its attempts. */
export interface RegenerationCycleContext {
  abortSignal: AbortSignal
  options: RegenerateOptions
  /** Runs one iteration of a loop's children; the context it gets carries that iteration's path. */
  asContainer<T>(
    zeroBasedIterationIndex: number,
    block: (context: RegenerationContainerContext) => Promise<T>,
  ): Promise<T>
  /**
   * Runs iterations of a loop's children side by side, at most `concurrency`
   * at once, one per key. Resolves when every started iteration has settled;
   * after the first failure no new iteration starts, and the failure is
   * rethrown once the running ones are done.
   */
  asContainers<T>(
    keys: string[],
    concurrency: number,
    block: (context: RegenerationContainerContext) => Promise<T>,
  ): Promise<T[]>
  asNode<T>(zeroBasedIterationIndex: number, block: (context: RegenerationNodeContext) => Promise<T>): Promise<T>
}
