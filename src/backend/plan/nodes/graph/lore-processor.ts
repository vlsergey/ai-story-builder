import type { LoreSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'lore' nodes.
 */
export class LoreProcessor implements NodeProcessor<LoreSettings> {
  readonly defaultSettings: LoreSettings = {}

  getOutput(_service: PlanNodeService, row: PlanNodeRow): unknown {
    return row.content ?? ""
  }

  async regenerate(
    _service: PlanNodeService,
    _context: RegenerationNodeContext,
    _row: PlanNodeRow,
    _settings: LoreSettings,
  ): Promise<PlanNodeStateUpdate | null> {
    return null
  }
}
