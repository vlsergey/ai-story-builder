import type { FormatSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import { renderFormatTemplate } from "../../../ai/replaceTemplates.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { NodeInputs } from "../NodeInput.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'format' nodes: render inputs through a Handlebars template.
 *
 * Presentation, not computation and not generation — an export layer for
 * whatever shape the result needs to leave in (HTML page, front matter,
 * a manifest). No LLM call, so it costs nothing and is deterministic.
 *
 * Unlike prompt rendering, HTML escaping is ON: `{{x}}` is safe, `{{{x}}}`
 * is the deliberate opt-out.
 */
export class FormatProcessor implements NodeProcessor<FormatSettings> {
  readonly defaultSettings: FormatSettings = { template: "" }

  getOutput(_context: PlanNodeService, nodeData: PlanNodeRow): unknown {
    return nodeData.content ?? ""
  }

  async regenerate(
    service: PlanNodeService,
    _context: RegenerationNodeContext | undefined,
    node: PlanNodeRow,
    settings: FormatSettings,
  ): Promise<PlanNodeUpdate> {
    const template = settings.template ?? ""
    if (template.trim().length === 0) return { content: "", status: "EMPTY" }

    const context = buildFormatContext(service.findNodeInputs(node.id))
    context.title = node.title

    try {
      return { content: renderFormatTemplate(template, context), status: "GENERATED" }
    } catch (err) {
      // Same reasoning as the script node: a silent empty result is
      // indistinguishable from "the template produced nothing".
      return { content: err instanceof Error ? err.message : String(err), status: "ERROR" }
    }
  }
}

/**
 * Inputs keyed by source node title, matching how prompts address them.
 * A `textArray` edge arrives as an array so `{{#each [Title]}}` works;
 * a `text` edge arrives as a string.
 */
export function buildFormatContext(nodeInputs: NodeInputs<unknown>): Record<string, unknown> {
  const context: Record<string, unknown> = {}
  for (const nodeInput of nodeInputs) {
    const title = nodeInput.sourceNode.title
    if (nodeInput.edge.type === "textArray") {
      const parts = (nodeInput.input as unknown[]) ?? []
      context[title] = parts.map((p) => (typeof p === "string" ? p : String(p ?? "")))
    } else {
      context[title] = typeof nodeInput.input === "string" ? nodeInput.input : String(nodeInput.input ?? "")
    }
  }
  return context
}
