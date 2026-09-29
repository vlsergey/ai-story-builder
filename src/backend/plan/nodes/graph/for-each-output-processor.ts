import type { ForEachOutputSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * A loop's output in one iteration: what is wired into it, joined. The loop
 * hands on one of these per iteration; a change here reaches the loop's
 * readers and, in a sequential loop, the later iterations.
 */
export class ForEachOutputProcessor implements NodeProcessor<ForEachOutputSettings> {
  readonly defaultSettings = {}

  getOutput(_service: PlanNodeService, row: PlanNodeRow): unknown {
    return row.content ?? ""
  }

  async onInputContentChange(service: PlanNodeService, row: PlanNodeRow): Promise<PlanNodeStateUpdate | null> {
    const { content, summary } = joinInputs(service, row)
    return row.content !== content ? { content, summary } : null
  }

  async regenerate(
    service: PlanNodeService,
    _context: RegenerationNodeContext,
    row: PlanNodeRow,
    _settings: ForEachOutputSettings,
  ): Promise<PlanNodeStateUpdate | null> {
    const { content, summary } = joinInputs(service, row)
    return row.content !== content ? { content, summary: summary || row.summary } : null
  }
}

function joinInputs(
  service: PlanNodeService,
  row: PlanNodeRow,
): { content: string; summary: string | null | undefined } {
  const nodeInputs = service.findNodeInputs(row.id, row.path)
  let content = ""
  for (const { input } of nodeInputs) {
    if (typeof input === "string") content += input
  }
  const summary = nodeInputs.length === 1 ? nodeInputs[0].sourceNode.summary : undefined
  return { content, summary }
}
