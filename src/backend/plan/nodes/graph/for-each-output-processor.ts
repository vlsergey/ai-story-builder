import type { ForEachOutputSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

export class ForEachOutputProcessor implements NodeProcessor<ForEachOutputSettings> {
  readonly defaultSettings = {}

  getOutput(context: PlanNodeService, node: PlanNodeRow): unknown {
    return node.content ?? ""
  }

  async onInputContentChange(context: PlanNodeService, node: PlanNodeRow): Promise<PlanNodeUpdate | null> {
    const nodeInputs = context.findNodeInputs(node.id)
    let content: string = ""
    for (const { input } of nodeInputs) {
      if (typeof input === "string") {
        content += input
      }
    }
    const summary = nodeInputs.length === 1 ? nodeInputs[0].sourceNode.summary : undefined

    if (node.content !== content) {
      return {
        content,
        summary,
      }
    }
    return null
  }

  async onUpdate?(
    service: PlanNodeService,
    _nodeId: number,
    oldNode: PlanNodeRow | null,
    newNode: PlanNodeRow | null,
    _settings: ForEachOutputSettings,
  ): Promise<PlanNodeUpdate | null> {
    const parentId = oldNode?.parent_id || newNode?.parent_id
    if (parentId === undefined || parentId === null) return null
    service.repo.updateForEachPrevOutputsStatusInsideForEachContent(parentId)
    return null
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    settings: ForEachOutputSettings,
  ): Promise<PlanNodeRow> {
    const nodeInputs = service.findNodeInputs(node.id)
    let content: string = ""
    for (const { input } of nodeInputs) {
      if (typeof input === "string") {
        content += input
      }
    }
    const summary = nodeInputs.length === 1 ? nodeInputs[0].sourceNode.summary : undefined

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
