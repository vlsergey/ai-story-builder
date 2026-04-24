import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import type { PlanNodeRow } from "../../../../shared/plan-graph"
import type { RegenerateOptions } from "../../../../shared/RegenerateOptions"

export type PlanNodeAiGenerationStatus = "EMPTY" | "SAME" | "GENERATED"

export interface RegenerationContainerContext {
  options: RegenerateOptions
  onNodeSkip(node: PlanNodeRow, skipReason: string): void
  onNodeStart<T>(
    node: PlanNodeRow,
    block: (context: RegenerationNodeContext) => Promise<{ result: T; status: PlanNodeAiGenerationStatus }>,
  ): Promise<T>
}

export interface RegenerationNodeContext {
  nodeId: number
  options: RegenerateOptions
  onNodeUpdated(node: PlanNodeRow): void
  onResponseStreamEvent(contentPath: (string | number)[], event: ResponseStreamEvent): void
  asContainer<T>(block: (context: RegenerationContainerContext) => Promise<T>): Promise<T>
  asCycle<T>(totalIterations: number | undefined, block: (context: RegenerationCycleContext) => Promise<T>): Promise<T>
}

export interface RegenerationCycleContext {
  options: RegenerateOptions
  asContainer<T>(
    zeroBasedIterationIndex: number,
    block: (context: RegenerationContainerContext) => Promise<T>,
  ): Promise<T>
  asNode<T>(zeroBasedIterationIndex: number, block: (context: RegenerationNodeContext) => Promise<T>): Promise<T>
}
