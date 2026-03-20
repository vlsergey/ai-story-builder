import type { NodeData, NodeContext } from '../node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType } from '../../../../shared/plan-graph'
import type { TextSettings } from '../../../../shared/node-settings'
import { generateNodeContent } from '../../ai-generation.js'

/**
 * Processor for 'text' nodes.
 */
export class TextProcessor implements NodeProcessor<TextSettings> {
  readonly supportedTypes: PlanNodeType[] = ['text']
  readonly defaultSettings: TextSettings = {}

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

  async onInputContentChange(context: NodeContext, nodeData: NodeData, changedInputNodeId: number, settings: TextSettings): Promise<NodeData | null> {
    // Text nodes have no inputs, so this should never be called
    return null
  }

  async regenerate(context: NodeContext, nodeData: NodeData, settings: TextSettings): Promise<string | null> {
    // Generate content using AI for text nodes
    console.log(`[TextProcessor] regenerating node ${nodeData.id} (title: ${nodeData.title})`)
    const content = await generateNodeContent(nodeData)
    console.log(`[TextProcessor] generated content length: ${content?.length ?? 'null'}`)
    return content
  }
}