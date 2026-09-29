import type { TextSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import { generatePlanNodeTextContent } from "../../../ai/generate-plan-node-text-content.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'text' nodes.
 */
export class TextProcessor implements NodeProcessor<TextSettings> {
  readonly defaultSettings: TextSettings = {}

  getOutput(_service: PlanNodeService, row: PlanNodeRow): unknown {
    return row.content ?? ""
  }

  // Whether a changed input demotes a text node is decided by the cascade
  // itself (`usesInput`), the same way propagation decides it.

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    row: PlanNodeRow,
    _settings: TextSettings,
  ): Promise<PlanNodeStateUpdate | null> {
    console.log(`[TextProcessor] regenerating node ${row.id} (title: ${row.title}) at "${row.path}"`)
    const inputs = service.findNodeInputsByType(row.id, row.path, "text")
    const content = await generatePlanNodeTextContent(context.abortSignal, row, inputs, (event) =>
      context.onResponseStreamEvent(["content"], event),
    )
    console.log(`[TextProcessor] generated content length: ${content?.length ?? "null"}`)
    if (content === row.content) return null
    return { content }
  }
}
