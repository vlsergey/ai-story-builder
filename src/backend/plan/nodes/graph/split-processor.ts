import type { SplitSettings } from "@shared/node-settings.js"
import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import { generateSplitParts } from "../../../ai/generate-split-parts.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'split' nodes.
 *
 * Splitting is now LLM-driven: the user describes how to split via the node's
 * `node_type_settings.userPrompt`, and the model returns a JSON array of parts.
 * Pure-regex splitting has been removed — see migration 027 for the legacy data
 * path; migration 028 moved prompts off the row into node_type_settings.
 */
export class SplitProcessor implements NodeProcessor<SplitSettings> {
  readonly defaultSettings: SplitSettings = {}

  getOutput(_service: PlanNodeService, row: PlanNodeRow): string[] {
    if (!row.content) return []
    try {
      const parsed = JSON.parse(row.content)
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
    row: PlanNodeRow,
    _settings: SplitSettings,
  ): Promise<PlanNodeStateUpdate | null> {
    const inputs = service.findNodeInputsByType(row.id, row.path, "text")
    if (inputs.length === 0) {
      return { content: JSON.stringify([]) }
    }

    const parts = await generateSplitParts(context.abortSignal, row, inputs, (event) =>
      context.onResponseStreamEvent(["content"], event),
    )

    const result: PlanNodeStateUpdate = { content: JSON.stringify(parts) }
    if (inputs.length === 1) {
      result.summary = inputs[0].sourceNode.summary
    }
    return result
  }
}
