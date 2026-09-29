import type { PlanNodeDefinition, PlanNodeRow } from "../../../../shared/plan-graph.js"
import type { PlanNodeService } from "../plan-node-service.js"

/** A loop's element or output node; every loop has exactly one of each. */
export function loopChild(
  service: PlanNodeService,
  loopId: number,
  type: "for-each-input" | "for-each-output",
): PlanNodeDefinition {
  const children = service.findByParentIdAndType(loopId, type)
  if (children.length !== 1) throw Error(`loop ${loopId} must have exactly one ${type}, has ${children.length}`)
  return children[0]
}

/** The loop's list at its path: each text input one element, each list input its parts. */
export function loopElements(service: PlanNodeService, row: PlanNodeRow): string[] {
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
