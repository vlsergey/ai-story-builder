import { promises as fs } from "node:fs"
import type { FormatSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import { ROOT_PATH } from "../../../../shared/plan-node-path.js"
import { renderFormatTemplate } from "../../../ai/replaceTemplates.js"
import { SettingsRepository } from "../../../settings/settings-repository.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { NodeInputs } from "../NodeInput.js"
import type { PlanNodeService } from "../plan-node-service.js"
import { DEFAULT_FILE_NAME, savedPagePath } from "./format-file.js"
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
 *
 * With `saveNextToProject`, every rebuild of the page also writes it into the
 * project's folder, under the name its mask gives — see `format-file.ts`.
 */
export class FormatProcessor implements NodeProcessor<FormatSettings> {
  readonly defaultSettings: FormatSettings = { template: "", saveNextToProject: false, fileName: DEFAULT_FILE_NAME }

  getOutput(_context: PlanNodeService, nodeData: PlanNodeRow): unknown {
    return nodeData.content ?? ""
  }

  async regenerate(
    service: PlanNodeService,
    _context: RegenerationNodeContext | undefined,
    node: PlanNodeRow,
    settings: FormatSettings,
  ): Promise<PlanNodeStateUpdate> {
    const template = settings.template ?? ""
    if (template.trim().length === 0) return { content: "", status: "EMPTY" }

    const context = buildFormatContext(service.findNodeInputs(node.id, node.path), SettingsRepository.getProjectTitle())
    context.title = node.title

    try {
      return { content: renderFormatTemplate(template, context), status: "GENERATED" }
    } catch (err) {
      // Same reasoning as the script node: a silent empty result is
      // indistinguishable from "the template produced nothing".
      return { content: err instanceof Error ? err.message : String(err), status: "ERROR" }
    }
  }

  /** Writes the page next to the project file, when the settings ask for it. */
  async afterRegeneration(_service: PlanNodeService, row: PlanNodeRow, settings: FormatSettings): Promise<void> {
    // Inside a loop every iteration would overwrite the same file.
    if (!settings.saveNextToProject || row.path !== ROOT_PATH || row.status !== "GENERATED") return
    const file = savedPagePath(settings.fileName ?? DEFAULT_FILE_NAME, row.title)
    if (!file) return
    await fs.writeFile(file, row.content ?? "", "utf8")
    console.info(`[FormatProcessor] node ${row.id} saved to ${file}`)
  }
}

/**
 * Inputs keyed by source node title, matching how prompts address them.
 * A `textArray` edge arrives as an array so `{{#each [Title]}}` works;
 * a `text` edge arrives as a string.
 */
export function buildFormatContext(
  nodeInputs: NodeInputs<unknown>,
  projectName?: string | null,
): Record<string, unknown> {
  // Seeded before the inputs so a node actually titled "projectName" wins:
  // what the graph states explicitly beats what the environment supplies.
  const context: Record<string, unknown> = { projectName: projectName ?? "" }
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
