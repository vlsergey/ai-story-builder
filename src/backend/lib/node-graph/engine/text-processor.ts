import type { NodeData, NodeContext } from '../node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType } from '../../../../shared/plan-graph'

/**
 * Processor for 'text' nodes.
 */
export class TextProcessor implements NodeProcessor {
  readonly supportedTypes: PlanNodeType[] = ['text']

  getInputEdgeTypes(): PlanEdgeType[] {
    // Text nodes are sources; they don't require inputs
    return []
  }

  getOutputEdgeType(): PlanEdgeType {
    return 'text'
  }

  getOutput(nodeData: NodeData): unknown {
    return nodeData.content ?? ''
  }

  async onContentChange(context: NodeContext, nodeData: NodeData, oldContent: string | null): Promise<void> {
    // Nothing to do by default
  }

  async regenerate(context: NodeContext, nodeData: NodeData, options?: unknown): Promise<string | null> {
    // No regeneration logic for plain text nodes
    return null
  }
}