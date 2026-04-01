import type { NodeContext } from './node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import type { ForEachSettings } from '../../../../shared/node-settings.js'

/**
 * Processor for 'for-each' nodes.
 * Iterates over an input array of texts, runs internal subgraph for each element,
 * and collects outputs into an array.
 */
export class ForEachProcessor implements NodeProcessor<ForEachSettings> {
  readonly supportedTypes: PlanNodeType[] = ['for-each']
  readonly defaultSettings: ForEachSettings = {}

  getInputEdgeTypes(): PlanEdgeType[] {
    // Accepts textArray as input (array of texts to iterate over)
    return ['textArray']
  }

  getOutputEdgeType(): PlanEdgeType {
    // Produces textArray as output (array of processed texts)
    return 'textArray'
  }

  getOutput(nodeData: PlanNodeRow): unknown {
    // Return parsed content as array of strings
    return this.parseContentAsJsonArray(nodeData)
  }

  private parseContentAsJsonArray(nodeData: PlanNodeRow): string[] {
    if (nodeData.content) {
      try {
        const parsed = JSON.parse(nodeData.content)
        if (Array.isArray(parsed)) {
          // Each element may be an object with content, or just a string
          return parsed.map((item: any) => typeof item === 'string' ? item : item.content || '')
        }
      } catch (_) {
        // Not valid JSON, treat as empty array
      }
    }
    return []
  }

  async onInputContentChange(
    context: NodeContext,
    nodeData: PlanNodeRow,
    changedInputNodeId: number,
    settings: ForEachSettings
  ): Promise<PlanNodeUpdate | null> {
    // For-each nodes do not auto-update when input changes
    return null
  }

  async regenerate(
    context: NodeContext,
    node: PlanNodeRow,
    settings: ForEachSettings
  ): Promise<PlanNodeUpdate | null> {
    console.log(`[ForEachProcessor] regenerating node ${node.id}`)

    // 1. Get input array from upstream node(s)
    const inputArray = this.getInputArray(context, node.id)
    if (!inputArray) {
      // No input, cannot generate
      return null
    }

    // 2. Get child nodes (subgraph inside for-each)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const childNodes = context.getByParentId(node.id) // will be used later
    // Find for-each-input and for-each-output nodes (special types?)
    // For now, assume first child is input, second is output (simplified)
    // TODO: implement proper detection

    // 3. For each input element, run subgraph generation
    const outputs: string[] = []
    for (let i = 0; i < inputArray.length; i++) {
      const element = inputArray[i]
      // TODO: set for-each-input content to element, run generation for child subgraph,
      // collect output from for-each-output
      // This is a placeholder: just copy input as output
      outputs.push(element)
    }

    // 4. Store outputs as JSON array
    const content = JSON.stringify(outputs)
    return { content }
  }

  private getInputArray(context: NodeContext, nodeId: number): string[] | null {
    const incoming = context.getIncomingEdges(nodeId)
    const textArrayEdge = incoming.find(edge => edge.type === 'textArray')
    if (!textArrayEdge) {
      return null
    }
    const sourceNode = context.getById(textArrayEdge.from_node_id)
    if (!sourceNode) {
      return null
    }
    const processor = context.getProcessor(sourceNode.type)
    if (!processor) {
      return null
    }
    const output = processor.getOutput(sourceNode)
    if (Array.isArray(output)) {
      return output.map(item => typeof item === 'string' ? item : String(item))
    }
    // If output is a single string, wrap it in array
    if (typeof output === 'string') {
      return [output]
    }
    return null
  }
}