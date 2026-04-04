import { PlanNodeService } from '../plan-node-service.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import type { SplitSettings } from '../../../../shared/node-settings.js'
import { AiRegenerateOptions } from '../../../../shared/ai-regenerate-all.js'

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

  onUpdate = async (
    context: PlanNodeService,
    nodeId: number,
    oldNode: PlanNodeRow | null,
    newNode: PlanNodeRow | null,
    settings: SplitSettings,
  ): Promise<PlanNodeUpdate | null> => {
    if (!newNode || !settings.autoUpdate) {
      return null
    }
    return await this.regenerate(context, {regenerateManual: false}, newNode, settings)
  }

  getOutput(context: PlanNodeService, nodeData: PlanNodeRow): unknown {
    return this.parseContentAsJsonArray(nodeData)
  }

  private parseContentAsJsonArray(nodeData: PlanNodeRow): string[] {
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

  private splitInput(context: PlanNodeService, nodeData: PlanNodeRow, settings: SplitSettings): string[] {
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

  private getInputText(context: PlanNodeService, nodeId: number): string | null {
    const incoming = context.getNodeInputs(nodeId)
    return incoming[0]?.input as string
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

  async onInputContentChange(context: PlanNodeService, nodeData: PlanNodeRow, changedInputNodeId: number, settings: SplitSettings): Promise<PlanNodeUpdate | null> {
    // Check if auto‑update is enabled
    if (!settings.autoUpdate) {
      return null
    }

    // Regenerate split content
    const newContentPatch = await this.regenerate(context, {regenerateManual: false}, nodeData, settings)
    if (newContentPatch?.content === null || newContentPatch?.content === nodeData.content) {
      // No change or generation failed
      return null
    }

    // Return updated node data
    return {
      content: newContentPatch?.content,
    }
  }

  regenerate = async (
    context: PlanNodeService,
    regenerateAllOptions: AiRegenerateOptions,
    nodeData: PlanNodeRow,
    settings: SplitSettings,
  ): Promise<PlanNodeUpdate | null> => {
    const parts = this.splitInput(context, nodeData, settings)
    return {
      content: JSON.stringify(parts)
    }
  }
}
