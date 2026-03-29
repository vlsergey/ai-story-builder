import type { NodeContext } from './node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeRow } from '../../../../shared/plan-graph.js'
import type { LoreSettings } from '../../../../shared/node-settings.js'

/**
 * Processor for 'lore' nodes.
 */
export class LoreProcessor implements NodeProcessor<LoreSettings> {
  readonly supportedTypes: PlanNodeType[] = ['lore']
  readonly defaultSettings: LoreSettings = {}

  getInputEdgeTypes(): PlanEdgeType[] {
    // Lore nodes are sources; they don't require inputs
    return []
  }

  getOutputEdgeType(): PlanEdgeType {
    return 'text'
  }

  getOutput(node: PlanNodeRow): unknown {
    return node.content ?? ''
  }

  async regenerate(context: NodeContext, node: PlanNodeRow, settings: LoreSettings): Promise<PlanNodeRow> {
    return node
  }
}