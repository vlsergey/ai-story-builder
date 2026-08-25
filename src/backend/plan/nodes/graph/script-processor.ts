import type { ScriptSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import { DEFAULT_SCRIPT_TIMEOUT_MS, runScript, type ScriptInput } from "../../../script/run-script.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { NodeInputs } from "../NodeInput.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'script' nodes: a deterministic text→text step.
 *
 * Exists because some checks are arithmetic, not judgement — n-gram repeats,
 * curve shape, word budgets. Asking an LLM to count 4-grams across 30 000 words
 * produces a plausible answer, not a correct one.
 */
export class ScriptProcessor implements NodeProcessor<ScriptSettings> {
  readonly defaultSettings: ScriptSettings = {
    source: "",
    timeoutMs: DEFAULT_SCRIPT_TIMEOUT_MS,
  }

  getOutput(_context: PlanNodeService, nodeData: PlanNodeRow): unknown {
    return nodeData.content ?? ""
  }

  async regenerate(
    service: PlanNodeService,
    _context: RegenerationNodeContext | undefined,
    node: PlanNodeRow,
    settings: ScriptSettings,
  ): Promise<PlanNodeUpdate> {
    const source = settings.source ?? ""
    if (source.trim().length === 0) {
      return { content: "", status: "EMPTY" }
    }

    const inputs = toScriptInputs(service.findNodeInputs(node.id))
    const result = runScript({
      source,
      inputs,
      timeoutMs: settings.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
    })

    if (!result.ok) {
      // Surface the failure in the node itself: a silent empty result would be
      // indistinguishable from "the check found nothing", which is the one
      // thing a checker must never be ambiguous about.
      const logs = result.logs.length > 0 ? `\n\n${result.logs.join("\n")}` : ""
      return { content: `${result.error}${logs}`, status: "ERROR" }
    }

    return { content: result.output, status: "GENERATED" }
  }
}

/** Flatten incoming edges to `{title, text}`, expanding textArray element-wise. */
export function toScriptInputs(nodeInputs: NodeInputs<unknown>): ScriptInput[] {
  const inputs: ScriptInput[] = []
  for (const nodeInput of nodeInputs) {
    switch (nodeInput.edge.type) {
      case "text":
        inputs.push({
          title: nodeInput.sourceNode.title,
          text: typeof nodeInput.input === "string" ? nodeInput.input : String(nodeInput.input ?? ""),
        })
        break
      case "textArray": {
        const parts = (nodeInput.input as unknown[]) ?? []
        parts.forEach((part, index) => {
          inputs.push({
            title: `${nodeInput.sourceNode.title} [${index + 1}]`,
            text: typeof part === "string" ? part : String(part ?? ""),
          })
        })
        break
      }
    }
  }
  return inputs
}
