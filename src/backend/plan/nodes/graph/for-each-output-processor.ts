import { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import { ForEachOutputSettings } from "../../../../shared/node-settings.js"

export class ForEachOutputProcessor implements NodeProcessor<ForEachOutputSettings> {
  readonly defaultSettings = {}

  getOutput(context: PlanNodeService, node: PlanNodeRow): unknown {
    return node.content ?? ""
  }

  async onInputContentChange(context: PlanNodeService, node: PlanNodeRow): Promise<PlanNodeUpdate | null> {
    const nodeInputs = context.getNodeInputs(node.id)
    let content: string = ""
    for (const { input } of nodeInputs) {
      if (typeof input === "string") {
        content += input
      }
    }
    const summary = nodeInputs.length == 1 ? nodeInputs[0].sourceNode.summary : undefined

    if (node.content !== content) {
      return {
        content,
        summary,
      }
    }
    return null
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    settings: ForEachOutputSettings,
  ): Promise<PlanNodeRow> {
    const nodeInputs = service.getNodeInputs(node.id)
    let content: string = ""
    for (const { input } of nodeInputs) {
      if (typeof input === "string") {
        content += input
      }
    }
    const summary = nodeInputs.length == 1 ? nodeInputs[0].sourceNode.summary : undefined

    if (node.content !== content) {
      return {
        ...node,
        content,
        summary: summary || node.summary,
      }
    }
    return node
  }
}
