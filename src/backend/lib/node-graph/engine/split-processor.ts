import type { NodeData, NodeContext } from '../node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType } from '../../../../shared/plan-graph'
import type { SplitSettings } from '../../../../shared/node-settings'

/**
 * Processor for 'split' nodes.
 */
export class SplitProcessor implements NodeProcessor<SplitSettings> {
  readonly supportedTypes: PlanNodeType[] = ['split']
  readonly defaultSettings: SplitSettings = {
    separator: '',
    dropFirst: 0,
    dropLast: 0,
    autoUpdate: false,
  }

  getInputEdgeTypes(): PlanEdgeType[] {
    return ['text']
  }

  getOutputEdgeType(): PlanEdgeType {
    return 'textArray'
  }

  getOutput(nodeData: NodeData): unknown {
    return this.parseContentAsJsonArray(nodeData)
  }

  private parseContentAsJsonArray(nodeData: NodeData): string[] {
    // Try to parse content as JSON array of split parts
    if (nodeData.content) {
      try {
        const parsed = JSON.parse(nodeData.content)
        if (Array.isArray(parsed)) {
          // Assume each element has a 'content' field (or is a string)
          return parsed.map((item: any) => typeof item === 'string' ? item : item.content || '')
        }
      } catch (_) {
        // Not valid JSON, treat as empty array
      }
    }
    return []
  }

  private splitInput(context: NodeContext, nodeData: NodeData, settings: SplitSettings): string[] {
    const inputText = this.getInputText(context, nodeData.id)
    if (inputText === null) {
      return []
    }
    let parts = this.splitTextByRegex(inputText, settings.separator)
    // Apply dropFirst and dropLast
    if (settings.dropFirst > 0) {
      parts = parts.slice(settings.dropFirst)
    }
    if (settings.dropLast > 0) {
      parts = parts.slice(0, -settings.dropLast)
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
    } catch (_) {
      // If regex is invalid, treat as literal string split
      return text.split(regexPattern)
    }
  }

  async onContentChange(context: NodeContext, nodeData: NodeData, oldContent: string | null): Promise<void> {
    // If split node's content changes (e.g., separator), downstream nodes may need update
    // For now, do nothing (auto‑update could be added later)
  }

  async onInputContentChange(context: NodeContext, nodeData: NodeData, changedInputNodeId: number, settings: SplitSettings): Promise<NodeData | null> {
    // Check if the changed input is the one we depend on
    const incoming = context.getIncomingEdges(nodeData.id)
    const depends = incoming.some(edge => edge.from_node_id === changedInputNodeId && edge.type === 'text')
    if (!depends) {
      return null
    }

    // Check if auto‑update is enabled
    if (!settings.autoUpdate) {
      return null
    }

    // Regenerate split content
    const newContent = await this.regenerate(context, nodeData, settings)
    if (newContent === null || newContent === nodeData.content) {
      // No change or generation failed
      return null
    }

    // Return updated node data
    return {
      ...nodeData,
      content: newContent,
    }
  }

  async regenerate(context: NodeContext, nodeData: NodeData, settings: SplitSettings): Promise<string | null> {
    const parts = this.splitInput(context, nodeData, settings)
    return JSON.stringify(parts)
  }
}