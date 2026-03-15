import type { NodeData, NodeContext } from '../node-interfaces.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType } from '../../../../shared/plan-graph'

/**
 * Processor for 'merge' nodes.
 */
export class MergeProcessor implements NodeProcessor {
  readonly supportedTypes: PlanNodeType[] = ['merge']

  getInputEdgeTypes(): PlanEdgeType[] {
    // Merge node can accept both 'text' and 'textArray' edges
    return ['text', 'textArray']
  }

  getOutputEdgeType(): PlanEdgeType {
    // Merge node can output 'text' (the merged content)
    return 'text'
  }

  getOutput(context: NodeContext, nodeData: NodeData): unknown {
    // For now, we don't compute merged content automatically because it's heavy.
    // Instead, we rely on explicit generation via regenerate().
    // Return empty string as placeholder.
    return ''
  }

  async onContentChange(context: NodeContext, nodeData: NodeData, oldContent: string | null): Promise<void> {
    // If merge node's own content changes? Usually merge node's content is generated.
    // Do nothing.
  }

  async onInputContentChange(context: NodeContext, nodeData: NodeData, changedInputNodeId: number): Promise<void> {
    // Check if auto‑update is enabled
    const settings = this.parseSettings(nodeData.node_type_settings)
    if (!settings.autoUpdate) {
      return
    }

    // Regenerate merged content
    const newContent = await this.generateMergedContent(context, nodeData, {})
    if (newContent === null || newContent === nodeData.content) {
      // No change or generation failed
      return
    }

    // Update node content via GraphEngine (assume context is GraphEngine)
    const engine = context as any
    if (typeof engine.updateNodeContent === 'function') {
      await engine.updateNodeContent(nodeData.id, newContent)
    } else {
      // Fallback: log warning
      console.warn('Cannot update merge node content: updateNodeContent not available')
    }
  }

  async regenerate(context: NodeContext, nodeData: NodeData, options?: unknown): Promise<string | null> {
    // Generate merged content using the existing logic.
    // We'll need to fetch inputs (including expansion) and apply settings.
    // For simplicity, we'll delegate to the existing generateMergeContent function.
    // However, we need a Database instance; context is GraphEngine which has a db.
    // Since we cannot import generateMergeContent due to circular dependency,
    // we'll implement the logic here.
    return this.generateMergedContent(context, nodeData, options as any)
  }

  private parseSettings(nodeTypeSettings: string | null): { autoUpdate: boolean } {
    const defaultSettings = {
      autoUpdate: false,
    }
    if (!nodeTypeSettings) {
      return defaultSettings
    }
    try {
      const parsed = JSON.parse(nodeTypeSettings)
      return {
        autoUpdate: parsed.autoUpdate === true,
      }
    } catch (e) {
      return defaultSettings
    }
  }

  private async generateMergedContent(
    context: NodeContext,
    nodeData: NodeData,
    options?: { overrideSettings?: Record<string, any>; overrideTitle?: string }
  ): Promise<string> {
    // Parse settings
    const defaultSettings = {
      includeNodeTitle: false,
      includeInputTitles: false,
      fixHeaders: false,
      autoUpdate: false,
    }
    let settings = defaultSettings
    if (options?.overrideSettings !== undefined) {
      settings = { ...defaultSettings, ...options.overrideSettings }
    } else if (nodeData.node_type_settings) {
      try {
        settings = { ...defaultSettings, ...JSON.parse(nodeData.node_type_settings) }
      } catch (e) {
        // If JSON invalid, keep defaults
      }
    }

    const nodeTitle = options?.overrideTitle ?? nodeData.title

    // Fetch inputs (expanded)
    const inputs = await this.getExpandedInputs(context, nodeData.id)

    let content = ''

    // Add node title as h1 if enabled
    if (settings.includeNodeTitle) {
      content += `# ${nodeTitle}\n\n`
    }

    // Add each input
    for (const input of inputs) {
      if (input.content) {
        // Add input title as h2 if enabled
        if (settings.includeInputTitles) {
          content += `## ${input.title}\n\n`
        }

        let inputContent = input.content

        // Fix headers if enabled
        if (settings.fixHeaders) {
          inputContent = this.fixHeaders(inputContent)
        }

        content += inputContent + '\n\n'
      }
    }

    // Remove trailing newlines
    content = content.trim()
    return content
  }

  private async getExpandedInputs(context: NodeContext, nodeId: number): Promise<Array<{ title: string; content: string | null }>> {
    // Get incoming edges
    const edges = context.getIncomingEdges(nodeId)
    const inputs: Array<{ title: string; content: string | null }> = []

    for (const edge of edges) {
      const sourceNode = context.getNode(edge.from_node_id)
      if (!sourceNode) continue

      if (edge.type === 'text') {
        inputs.push({
          title: sourceNode.title,
          content: sourceNode.content,
        })
      } else if (edge.type === 'textArray') {
        // Get splitter output
        const splitProcessor = new (await import('./split-processor.js')).SplitProcessor()
        const parts = splitProcessor.getOutput(context, sourceNode)
        if (Array.isArray(parts)) {
          parts.forEach((part, index) => {
            inputs.push({
              title: `${sourceNode.title} [${index + 1}]`,
              content: typeof part === 'string' ? part : String(part),
            })
          })
        }
      }
    }

    // TODO: sort by edge position
    return inputs
  }

  private fixHeaders(text: string): string {
    // Implementation copied from generateMergeContent
    const lines = text.split('\n')
    const headerLines: { index: number; level: number; line: string }[] = []
    lines.forEach((line, idx) => {
      const match = line.match(/^(#{1,6})\s+(.*)/)
      if (match) {
        const level = match[1].length
        headerLines.push({ index: idx, level, line })
      }
    })

    if (headerLines.length > 0) {
      // Find minimum header level
      const minLevel = Math.min(...headerLines.map(h => h.level))
      // Count headers with minLevel
      const minLevelHeaders = headerLines.filter(h => h.level === minLevel)
      // Check if the first non-empty line is a header of minLevel
      const firstNonEmptyIdx = lines.findIndex(line => line.trim() !== '')
      const isFirstLineHeader = firstNonEmptyIdx >= 0 && headerLines.some(h => h.index === firstNonEmptyIdx && h.level === minLevel)

      // If there is exactly one header of minLevel and it's the first non-empty line, remove the line entirely
      if (minLevelHeaders.length === 1 && isFirstLineHeader) {
        const target = minLevelHeaders[0]
        lines.splice(target.index, 1)
        // Remove any leading empty lines that may have been left after removal
        let removedCount = 1
        while (target.index < lines.length && lines[target.index].trim() === '') {
          lines.splice(target.index, 1)
          removedCount++
        }
        // Adjust indices of headers after the removed lines
        headerLines.forEach(h => {
          if (h.index > target.index) h.index -= removedCount
        })
        // Remove the target from headerLines
        headerLines.splice(headerLines.indexOf(target), 1)
      }

      // After possible removal, recompute minLevel among remaining headers
      const remainingMinLevel = headerLines.length > 0 ? Math.min(...headerLines.map(h => h.level)) : 6
      // Shift all headers so that the highest level becomes h3 (level 3)
      const shift = 3 - remainingMinLevel
      if (shift > 0) {
        headerLines.forEach(h => {
          const newLevel = Math.min(h.level + shift, 6)
          const newLine = '#'.repeat(newLevel) + h.line.substring(h.level)
          lines[h.index] = newLine
        })
      }
    }

    return lines.join('\n')
  }
}