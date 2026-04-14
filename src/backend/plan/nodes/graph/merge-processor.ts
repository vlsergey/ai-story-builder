import { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import type { MergeSettings } from "../../../../shared/node-settings.js"
import { RegenerationNodeContext } from "../generate/RegenerationContext.js"

/**
 * Processor for 'merge' nodes.
 */
export class MergeProcessor implements NodeProcessor<MergeSettings> {
  readonly defaultSettings: MergeSettings = {
    includeNodeTitle: false,
    includeInputTitles: false,
    fixHeaders: false,
    autoUpdate: false,
  }

  getOutput(context: PlanNodeService, nodeData: PlanNodeRow): unknown {
    // Return the current content (which should be the merged content).
    return nodeData.content ?? ""
  }

  async onInputContentChange(
    context: PlanNodeService,
    nodeData: PlanNodeRow,
    changedInputNodeId: number,
    settings: MergeSettings,
  ): Promise<PlanNodeUpdate | null> {
    // Check if auto‑update is enabled
    if (!settings.autoUpdate) {
      console.log(`[MergeProcessor] autoUpdate disabled for node ${nodeData.id}`)
      return null
    }

    console.log(
      `[MergeProcessor] onInputContentChange called for node ${nodeData.id}, changed input ${changedInputNodeId}`,
    )
    // Regenerate merged content
    const patch = await this.regenerate(context, undefined, nodeData, settings)
    console.log(`[MergeProcessor] regenerated content:`, patch?.content)
    if (!patch?.content || patch?.content === nodeData.content) {
      // No change or generation failed
      console.log(`[MergeProcessor] no change or empty content, skipping update`)
      return null
    }

    // Return updated node data
    console.log(`[MergeProcessor] returning new content`)
    return {
      content: patch?.content,
    }
  }

  onUpdate = async (
    context: PlanNodeService,
    nodeId: number,
    oldNode: PlanNodeRow | null,
    newNode: PlanNodeRow | null,
    settings: MergeSettings,
  ): Promise<PlanNodeUpdate | null> => {
    if (newNode === null || !settings.autoUpdate) {
      return null
    }
    console.log(`Regenerating auto-updatable merge node ${nodeId}`)
    return await this.regenerate(context, undefined, newNode, settings)
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext | undefined,
    node: PlanNodeRow,
    settings: MergeSettings,
  ): Promise<PlanNodeUpdate> {
    const nodeTitle = node.title

    // Fetch inputs (expanded)
    const inputs = this.getExpandedInputs(service, node.id)

    let content = ""

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

        content += inputContent + "\n\n"
      }
    }

    // Remove trailing newlines
    content = content.trim()

    return {
      content: content,
    }
  }

  private getExpandedInputs = (
    context: PlanNodeService,
    nodeId: number,
  ): Array<{ title: string; content: string | null }> => {
    // Get incoming edges
    const nodeInputs = context.getNodeInputs(nodeId)
    const inputs: Array<{ title: string; content: string | null }> = []

    for (const nodeInput of nodeInputs) {
      switch (nodeInput.edge.type) {
        case "text":
          inputs.push({
            title: nodeInput.sourceNode.title,
            content: nodeInput.input as string,
          })
          break
        case "textArray": {
          const parts = nodeInput.input as string[]
          parts.forEach((part, index) => {
            inputs.push({
              title: `${nodeInput.sourceNode.title} [${index + 1}]`,
              content: typeof part === "string" ? part : String(part),
            })
          })
          break
        }
      }
    }
    return inputs
  }

  private fixHeaders(text: string): string {
    // Implementation copied from generateMergeContent
    const lines = text.split("\n")
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
      const minLevel = Math.min(...headerLines.map((h) => h.level))
      // Count headers with minLevel
      const minLevelHeaders = headerLines.filter((h) => h.level === minLevel)
      // Check if the first non-empty line is a header of minLevel
      const firstNonEmptyIdx = lines.findIndex((line) => line.trim() !== "")
      const isFirstLineHeader =
        firstNonEmptyIdx >= 0 && headerLines.some((h) => h.index === firstNonEmptyIdx && h.level === minLevel)

      // If there is exactly one header of minLevel and it's the first non-empty line, remove the line entirely
      if (minLevelHeaders.length === 1 && isFirstLineHeader) {
        const target = minLevelHeaders[0]
        lines.splice(target.index, 1)
        // Remove any leading empty lines that may have been left after removal
        let removedCount = 1
        while (target.index < lines.length && lines[target.index].trim() === "") {
          lines.splice(target.index, 1)
          removedCount++
        }
        // Adjust indices of headers after the removed lines
        headerLines.forEach((h) => {
          if (h.index > target.index) h.index -= removedCount
        })
        // Remove the target from headerLines
        headerLines.splice(headerLines.indexOf(target), 1)
      }

      // After possible removal, recompute minLevel among remaining headers
      const remainingMinLevel = headerLines.length > 0 ? Math.min(...headerLines.map((h) => h.level)) : 6
      // Shift all headers so that the highest level becomes h3 (level 3)
      const shift = 3 - remainingMinLevel
      if (shift > 0) {
        headerLines.forEach((h) => {
          const newLevel = Math.min(h.level + shift, 6)
          const newLine = "#".repeat(newLevel) + h.line.substring(h.level)
          lines[h.index] = newLine
        })
      }
    }

    return lines.join("\n")
  }
}
