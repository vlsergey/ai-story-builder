import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import type { RegenerateOptions } from "../../../../shared/RegenerateOptions"
import type { PlanNodeRow } from "../../../../shared/plan-graph"

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
  options: RegenerateOptions
  onData(node: PlanNodeRow): void
  onEvent(event: ResponseStreamEvent): void
  /**
   * @param multiplier Indicates how many nodes or iterations are living in this container.
   * Will be used to upgrade expected queue length / time expectations.
   */
  asContainer<T>(multiplier: number, block: (context: RegenerationContainerContext) => Promise<T>): Promise<T>
}
