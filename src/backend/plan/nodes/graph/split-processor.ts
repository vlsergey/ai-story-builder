import type { SplitSettings } from "@shared/node-settings.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { NodeInputs } from "../NodeInput.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'split' nodes.
 */
export class SplitProcessor implements NodeProcessor<SplitSettings> {
  readonly defaultSettings: SplitSettings = {
    separator: "",
    dropFirst: 0,
    dropLast: 0,
  }

  getOutput(service: PlanNodeService, node: PlanNodeRow): unknown {
    return this.parseContentAsJsonArray(node)
  }

  private parseContentAsJsonArray(node: PlanNodeRow): string[] {
    // Try to parse content as JSON array of split parts
    if (node.content) {
      try {
        const parsed = JSON.parse(node.content)
        if (Array.isArray(parsed)) {
          // Assume each element has a 'content' field (or is a string)
          return parsed.map((item: any) => (typeof item === "string" ? item : item.content || ""))
        }
      } catch (_) {
        // Not valid JSON, treat as empty array
      }
    }
    return []
  }

  private splitInput(inputs: NodeInputs<string>, settings: SplitSettings): string[] {
    const inputText = inputs.map((i) => i.input).join("\n\n")
    if (inputText.trim().length === 0) {
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

  private splitTextByRegex(text: string, regexPattern: string): string[] {
    if (!regexPattern.trim()) {
      return [text]
    }
    try {
      const regex = new RegExp(regexPattern, "g")
      return text.split(regex)
    } catch (_) {
      // If regex is invalid, treat as literal string split
      return text.split(regexPattern)
    }
  }

  async regenerate(
    service: PlanNodeService,
    _context: RegenerationNodeContext | undefined,
    node: PlanNodeRow,
    settings: SplitSettings,
  ): Promise<PlanNodeUpdate | null> {
    console.log(`[SplitProcessor] regenerate called for node ${node.id}, settings:`, settings)

    const incomings = service.findNodeInputsByType(node.id, "text")
    const parts = this.splitInput(incomings, settings)
    console.log(`[SplitProcessor] splitInput returned parts:`, parts)
    const result: PlanNodeUpdate = {
      content: JSON.stringify(parts),
    }

    if (incomings.length === 1) {
      // for single input, use source node summary as summary
      result.summary = incomings[0].sourceNode.summary
    }

    return result
  }
}
