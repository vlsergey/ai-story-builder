import { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"
import type { PlanNodeRow } from "../../../../shared/plan-graph.js"

export class ForEachInputProcessor implements NodeProcessor<unknown> {
  readonly defaultSettings = {}

  getOutput(context: PlanNodeService, node: PlanNodeRow): string {
    return node.content ?? ""
  }
}
