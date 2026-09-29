import type { PlanNodeRow } from "../../../../shared/plan-graph.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

export class ForEachInputProcessor implements NodeProcessor<unknown> {
  readonly defaultSettings = {}

  /** The element of the iteration at the row's path; the loop writes it when it expands its list. */
  getOutput(_service: PlanNodeService, row: PlanNodeRow): string {
    return row.content ?? ""
  }
}
