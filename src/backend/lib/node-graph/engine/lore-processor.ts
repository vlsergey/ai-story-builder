import type { NodeData, NodeContext } from '../node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType } from '../../../../shared/plan-graph'

/**
 * Processor for 'lore' nodes.
 */
export class LoreProcessor implements NodeProcessor {
  readonly supportedTypes: PlanNodeType[] = ['lore']

  getInputEdgeTypes(): PlanEdgeType[] {
    // Lore nodes are sources; they don't require inputs
    return []
  }

  getOutputEdgeType(): PlanEdgeType {
    return 'text'
  }

  computeOutputs(context: NodeContext, nodeData: NodeData): unknown {
    return nodeData.content ?? ''
  }

  async onContentChange(context: NodeContext, nodeData: NodeData, oldContent: string | null): Promise<void> {
    // Nothing to do by default
  }

  async regenerate(context: NodeContext, nodeData: NodeData, options?: unknown): Promise<string | null> {
    // No regeneration logic for plain lore nodes (AI generation is handled elsewhere)
    return null
  }
}