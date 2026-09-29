import type { TextSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import { generatePlanNodeTextContent } from "../../../ai/generate-plan-node-text-content.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'text' nodes.
 */
export class TextProcessor implements NodeProcessor<TextSettings> {
  readonly defaultSettings: TextSettings = {}

  getOutput(context: PlanNodeService, nodeData: PlanNodeRow): unknown {
    return nodeData.content ?? ""
  }

  // Whether a changed input demotes a text node is decided by the cascade
  // itself (`usesInput`), the same way propagation decides it.

  async regenerate(
    _service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    _settings: TextSettings,
  ): Promise<PlanNodeUpdate | null> {
    // Generate content using AI for text nodes
    console.log(`[TextProcessor] regenerating node ${node.id} (title: ${node.title})`)
    const content = await generatePlanNodeTextContent(context.abortSignal, node, (event) =>
      context.onResponseStreamEvent(["content"], event),
    )
    console.log(`[TextProcessor] generated content length: ${content?.length ?? "null"}`)
    if (content === node.content) return null
    return { content }
  }
}
