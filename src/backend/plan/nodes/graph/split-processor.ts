import type { SplitSettings } from "@shared/node-settings.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import { generateSplitParts } from "../../../ai/generate-split-parts.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'split' nodes.
 *
 * Splitting is now LLM-driven: the user describes how to split via the node's
 * `ai_user_prompt`, and the model returns a JSON array of parts. Pure-regex
 * splitting has been removed — see migration 027 for the legacy data path.
 */
export class SplitProcessor implements NodeProcessor<SplitSettings> {
  readonly defaultSettings: SplitSettings = {}

  getOutput(_service: PlanNodeService, node: PlanNodeRow): string[] {
    if (!node.content) return []
    try {
      const parsed = JSON.parse(node.content)
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
        return parsed
      }
    } catch {
      // fall through
    }
    return []
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    _settings: SplitSettings,
  ): Promise<PlanNodeUpdate | null> {
    const inputs = service.findNodeInputsByType(node.id, "text")
    if (inputs.length === 0) {
      return { content: JSON.stringify([]) }
    }

    const parts = await generateSplitParts(context.abortSignal, node, (event) =>
      context.onResponseStreamEvent(["content"], event),
    )

    const result: PlanNodeUpdate = { content: JSON.stringify(parts) }
    if (inputs.length === 1) {
      result.summary = inputs[0].sourceNode.summary
    }
    return result
  }
}
