import { PlanNodeService } from '../plan-node-service.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeRow } from '../../../../shared/plan-graph.js'
import type { LoreSettings } from '../../../../shared/node-settings.js'
import { RegenerationNodeContext } from '../generate/RegenerationContext.js'

/**
 * Processor for 'lore' nodes.
 */
export class LoreProcessor implements NodeProcessor<LoreSettings> {
  readonly defaultSettings: LoreSettings = {}

  getOutput(context: PlanNodeService, node: PlanNodeRow): unknown {
    return node.content ?? ''
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    settings: LoreSettings
  ): Promise<PlanNodeRow> {
    return node
  }
}