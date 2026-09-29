import { type ForEachNodeContent, loopLength } from "../../../../shared/for-each-plan-node.js"
import type { ForEachSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import { childPath } from "../../../../shared/plan-node-path.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import { regenerateSubtreeNodesContents } from "../generate/regenerateTreeNodesContents.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * A loop over a list: its children run once per element, in order, each
 * iteration with its own state at `<loop path>/<loop id>:<index>`. The loop
 * itself stores only how many iterations it has.
 */
export class ForEachProcessor implements NodeProcessor<ForEachSettings> {
  readonly defaultSettings: ForEachSettings = {}

  /** One output per element: the output child's content in each iteration. */
  getOutput(service: PlanNodeService, row: PlanNodeRow): string[] {
    const length = loopLength(row.content)
    if (length === 0) return []
    const output = onlyChild(service, row.id, "for-each-output")
    return Array.from(
      { length },
      (_, index) => service.states.find(output.id, childPath(row.path, row.id, index))?.content ?? "",
    )
  }

  // A changed list only makes the loop stale — the cascade does that for any
  // reader. The loop re-reads its list when it runs.

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    row: PlanNodeRow,
    _settings: ForEachSettings,
  ): Promise<PlanNodeStateUpdate | null> {
    const elements = expandedInputs(service, row)
    const input = onlyChild(service, row.id, "for-each-input")

    // An element that is new or changed gets its iteration's input written;
    // the cascade demotes what reads it in that iteration and nowhere else.
    // The input itself is left to settle in its iteration's run, which counts
    // and summarizes it like any other node.
    for (let index = 0; index < elements.length; index++) {
      const path = childPath(row.path, row.id, index)
      if (service.states.find(input.id, path)?.content !== elements[index]) {
        await service.patchState(input.id, path, false, { content: elements[index], status: "OUTDATED" })
      }
    }
    // Iterations whose element vanished go, with everything nested in them.
    service.states.deleteIterationsFrom(row.id, row.path, elements.length)

    console.log(`[ForEachProcessor] node ${row.id} at "${row.path}": ${elements.length} iteration(s)`)
    await context.asCycle(elements.length, async (cycle) => {
      for (let index = 0; index < elements.length; index++) {
        await cycle.asContainer(index, (childContext) => regenerateSubtreeNodesContents(childContext, row.id))
      }
    })

    const content: ForEachNodeContent = { length: elements.length }
    return { content: JSON.stringify(content) }
  }
}

function onlyChild(service: PlanNodeService, loopId: number, type: "for-each-input" | "for-each-output") {
  const children = service.findByParentIdAndType(loopId, type)
  if (children.length !== 1)
    throw Error(`for-each node ${loopId} must have exactly one ${type}, has ${children.length}`)
  return children[0]
}

/** The loop's list at its path: each text input one element, each list input its parts. */
function expandedInputs(service: PlanNodeService, row: PlanNodeRow): string[] {
  const elements: string[] = []
  for (const nodeInput of service.findNodeInputs(row.id, row.path)) {
    switch (nodeInput.edge.type) {
      case "text":
        elements.push(nodeInput.input as string)
        break
      case "textArray":
        elements.push(...(nodeInput.input as string[]))
        break
    }
  }
  return elements
}
