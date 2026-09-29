import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import { childPath, lastSegment, parentPath } from "../../../../shared/plan-node-path.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * The outputs of the iterations before this one — a sequential loop's memory.
 * In iteration `j` of loop `C` at `P` it reads the loop's output child at
 * `P/C:0 … P/C:(j−1)`.
 */
export class ForEachPrevOutputsProcessor implements NodeProcessor<unknown> {
  readonly defaultSettings = {}

  getOutput(service: PlanNodeService, row: PlanNodeRow): string[] {
    const loopId = row.parent_id
    const segment = lastSegment(row.path)
    if (loopId === null || !segment || segment.containerId !== loopId) {
      throw new Error(`For-each-prev-outputs node ${row.id} must run inside a for-each iteration, not at "${row.path}"`)
    }
    const outputs = service.findByParentIdAndType(loopId, "for-each-output")
    if (outputs.length !== 1) {
      throw new Error(`For-each node ${loopId} must have exactly one for-each-output node, has ${outputs.length}`)
    }
    const loopPath = parentPath(row.path)
    return Array.from(
      { length: Number(segment.key) },
      (_, index) => service.states.find(outputs[0].id, childPath(loopPath, loopId, index))?.content ?? "",
    )
  }

  /**
   * Keeps the outputs it reads in its own content. They live in other
   * iterations' rows, not in this one, so without the copy nothing downstream
   * would learn that an earlier iteration's result changed: the cascade
   * follows content. On the first iteration there is nothing before it — EMPTY.
   */
  async regenerate(
    service: PlanNodeService,
    _context: RegenerationNodeContext,
    row: PlanNodeRow,
  ): Promise<PlanNodeStateUpdate> {
    const outputs = this.getOutput(service, row)
    return outputs.length === 0 ? { content: null, status: "EMPTY" } : { content: JSON.stringify(outputs) }
  }
}
