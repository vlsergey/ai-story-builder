import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import { lastSegment } from "../../../../shared/plan-node-path.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'for-each-index' nodes: the iteration's 1-based position, read
 * from the last segment of the node's own path — the loop that holds it.
 */
export class ForEachIndexProcessor implements NodeProcessor<unknown> {
  readonly defaultSettings: unknown = {}

  getOutput(_service: PlanNodeService, row: PlanNodeRow): string {
    return indexString(row)
  }

  /**
   * Set summary = the iteration number too. PlanNodeService.regenerate skips
   * its LLM auto-summary call when patch.summary is already defined, so this
   * is the place to short-circuit and avoid a useless `generate-summary` call
   * on a node whose content is literally "5".
   */
  async regenerate(_service: PlanNodeService, _context: unknown, row: PlanNodeRow): Promise<PlanNodeStateUpdate> {
    const value = indexString(row)
    return {
      summary: value,
      status: value.length > 0 ? "GENERATED" : "EMPTY",
    }
  }
}

function indexString(row: PlanNodeRow): string {
  const segment = lastSegment(row.path)
  if (!segment || segment.containerId !== row.parent_id) return ""
  const index = Number(segment.key)
  return Number.isInteger(index) ? String(index + 1) : ""
}
