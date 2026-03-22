import type { NodeData, NodeContext } from '../node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType } from '../../../../shared/plan-graph.js'
import type { LoreSettings } from '../../../../shared/node-settings.js'
import { generateNodeContent } from '../../ai-generation.js'

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

  getOutput(nodeData: NodeData): unknown {
    return nodeData.content ?? ''
  }

  async onContentChange(context: NodeContext, nodeData: NodeData, oldContent: string | null): Promise<void> {
    // Nothing to do by default
  }

  async onInputContentChange(context: NodeContext, nodeData: NodeData, changedInputNodeId: number, settings: LoreSettings): Promise<NodeData | null> {
    // Lore nodes have no inputs, so this should never be called
    return null
  }

  async regenerate(context: NodeContext, nodeData: NodeData, settings: LoreSettings): Promise<string | null> {
    return await generateNodeContent(nodeData)
  }
}