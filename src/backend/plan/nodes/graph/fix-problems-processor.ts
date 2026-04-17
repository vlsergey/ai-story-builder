import type {
  FixIteration,
  FixProblemsPlanNodeContent,
  FixProblemsPlanNodeSettings,
} from "../../../../shared/fix-problems-plan-node.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import { findProblems, fixProblems } from "../../../ai/generate-fix-problems.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

export class FixProblemsProcessor implements NodeProcessor<FixProblemsPlanNodeSettings> {
  readonly defaultSettings = {
    maxIterations: 10,
    minSeverityToFix: 10,
    foundProblemsTemplate: "Found Problems",
  } as const

  getOutput(context: PlanNodeService, node: PlanNodeRow): string {
    const content = JSON.parse(node.content ?? "{}") as FixProblemsPlanNodeContent
    const iterations = content.iterations ?? []
    // Last iteration may not have fixProblemsResult, because problems severty may be less than minSeverityToFix
    return (
      iterations[iterations.length - 1]?.fixProblemsResult ?? iterations[iterations.length - 2]?.fixProblemsResult ?? ""
    )
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    settings: FixProblemsPlanNodeSettings,
  ): Promise<PlanNodeUpdate | null> {
    console.debug("[FixProblemsProcessor]", "regenerate", "node", node)
    console.debug("[FixProblemsProcessor]", "regenerate", "settings", settings)
    const maxIterations = settings.maxIterations ?? this.defaultSettings.maxIterations
    const minSeverityToFix = settings.minSeverityToFix ?? this.defaultSettings.minSeverityToFix
    const foundProblemsTemplate = settings.foundProblemsTemplate ?? this.defaultSettings.foundProblemsTemplate

    const inputs = service.findNodeInputsByType(node.id, "text")
    let inputToFix: (typeof inputs)[number]
    if (inputs.length === 0) {
      // nothing to fix
      return {
        status: "EMPTY",
        content: "{}",
      }
    } else if (inputs.length === 1) {
      inputToFix = inputs[0]
    } else {
      const sourceNodeIdToFix = settings.sourceNodeIdToFix
      if (sourceNodeIdToFix === undefined || sourceNodeIdToFix === null) {
        throw Error(
          `Source node ID to fix is not specified in node #${node.id} ('${node.title}') settings, but multiple inputs are present`,
        )
      }
      const inputToFixCandidate = inputs.find((input) => input.sourceNode.id === sourceNodeIdToFix)
      if (inputToFixCandidate === undefined) {
        throw Error(
          `Source node ID in node #${node.id} ('${node.title}') settings, but missing amoung inputs. Present sources are:\n` +
            inputs.map((i) => `#${i.sourceNode.id} '${i.sourceNode.title}' (${i.sourceNode.type})`).join("\n"),
        )
      }
      inputToFix = inputToFixCandidate
    }
    const originalInput = inputToFix.input

    const newContent: FixProblemsPlanNodeContent = {
      iterations: [],
    }
    await context.asCycle(maxIterations ?? undefined, async (cycleContext) => {
      let iteration = 0
      let input = originalInput
      let maxSeverity = 100

      while (iteration < maxIterations && maxSeverity >= minSeverityToFix) {
        const iterationResult: FixIteration = { input }
        newContent.iterations.push(iterationResult)

        await cycleContext.asNode(iteration, async (nodeContext) => {
          const findProblemsResult = await findProblems(node, input, nodeContext.onEvent)
          iterationResult.findProblemsResult = findProblemsResult
          iteration++
          maxSeverity =
            iterationResult.findProblemsResult?.foundProblems.reduce(
              (max, problem) => Math.max(max, problem.severity),
              0,
            ) ?? 0

          if (maxSeverity >= minSeverityToFix) {
            const fixProblemsResult = await fixProblems(
              node,
              input,
              foundProblemsTemplate,
              findProblemsResult,
              nodeContext.onEvent,
            )
            iterationResult.fixProblemsResult = fixProblemsResult
            input = fixProblemsResult
          }
        })
      }
    })

    return {
      content: JSON.stringify(newContent),
      status: "GENERATED",
    }
  }
}
