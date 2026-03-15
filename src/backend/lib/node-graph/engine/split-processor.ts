import type { NodeData, NodeContext } from '../node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType } from '../../../../shared/plan-graph'

/**
 * Processor for 'split' nodes.
 */
export class SplitProcessor implements NodeProcessor {
  readonly supportedTypes: PlanNodeType[] = ['split']

  getInputEdgeTypes(): PlanEdgeType[] {
    return ['text']
  }

  getOutputEdgeType(): PlanEdgeType {
    return 'textArray'
  }

  computeOutputs(context: NodeContext, nodeData: NodeData): Map<PlanEdgeType, unknown> {
    const output = this.getOutputTexts(context, nodeData)
    const map = new Map<PlanEdgeType, unknown>()
    map.set('textArray', output)
    return map
  }

  private getOutputTexts(context: NodeContext, nodeData: NodeData): string[] {
    // Try to parse content as JSON array of split parts
    if (nodeData.content) {
      try {
        const parsed = JSON.parse(nodeData.content)
        if (Array.isArray(parsed)) {
          // Assume each element has a 'content' field (or is a string)
          return parsed.map((item: any) => typeof item === 'string' ? item : item.content || '')
        }
      } catch (e) {
        // Not valid JSON, treat as regex pattern (legacy)
      }
    }

    // Fallback to splitting using pattern from node_type_settings
    let regexPattern = ''
    let dropFirst = 0
    let dropLast = 0
    if (nodeData.node_type_settings) {
      try {
        const settings = JSON.parse(nodeData.node_type_settings)
        if (settings.separator !== undefined) {
          regexPattern = settings.separator
        }
        if (settings.dropFirst !== undefined) {
          dropFirst = Number(settings.dropFirst) || 0
        }
        if (settings.dropLast !== undefined) {
          dropLast = Number(settings.dropLast) || 0
        }
      } catch (e) {
        // ignore
      }
    }
    // If no separator in settings, fallback to content as regex pattern (legacy)
    if (!regexPattern && nodeData.content) {
      regexPattern = nodeData.content
    }
    const inputText = this.getInputText(context, nodeData.id)
    if (inputText === null) {
      return []
    }
    let parts = this.splitTextByRegex(inputText, regexPattern)
    // Apply dropFirst and dropLast
    if (dropFirst > 0) {
      parts = parts.slice(dropFirst)
    }
    if (dropLast > 0) {
      parts = parts.slice(0, -dropLast)
    }
    return parts
  }

  private getInputText(context: NodeContext, nodeId: number): string | null {
    const incoming = context.getIncomingEdges(nodeId)
    const textEdge = incoming.find(edge => edge.type === 'text')
    if (!textEdge) {
      return null
    }
    const sourceNode = context.getNode(textEdge.from_node_id)
    if (!sourceNode) {
      return null
    }
    return sourceNode.content ?? null
  }

  private splitTextByRegex(text: string, regexPattern: string): string[] {
    if (!regexPattern.trim()) {
      return [text]
    }
    try {
      const regex = new RegExp(regexPattern, 'g')
      return text.split(regex)
    } catch (error) {
      // If regex is invalid, treat as literal string split
      return text.split(regexPattern)
    }
  }

  async onContentChange(context: NodeContext, nodeData: NodeData, oldContent: string | null): Promise<void> {
    // If split node's content changes (e.g., separator), downstream nodes may need update
    // For now, do nothing (auto‑update could be added later)
  }

  async onInputContentChange(context: NodeContext, nodeData: NodeData, changedInputNodeId: number): Promise<void> {
    // Check if the changed input is the one we depend on
    const incoming = context.getIncomingEdges(nodeData.id)
    const depends = incoming.some(edge => edge.from_node_id === changedInputNodeId && edge.type === 'text')
    if (!depends) {
      return
    }

    // Notify downstream nodes that our output may have changed
    const engine = context as any
    if (typeof engine.notifyDownstreamNodes === 'function') {
      await engine.notifyDownstreamNodes(nodeData.id)
    }
  }

  async regenerate(context: NodeContext, nodeData: NodeData, options?: unknown): Promise<string | null> {
    // Regeneration could re‑split based on current input
    // For now, return null (no new content)
    return null
  }
}