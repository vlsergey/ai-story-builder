import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"
import type { PlanNodeRow } from "../../../../shared/plan-graph.js"
import type { ForEachNodeContent } from "../../../../shared/for-each-plan-node.js"

export class ForEachPrevOutputsProcessor implements NodeProcessor<unknown> {
  readonly defaultSettings = {}

  getOutput(service: PlanNodeService, node: PlanNodeRow): string[] {
    // This method assumes that previous content is stored in for-each-output nodes of for-each,
    // Thus we don't need to use 'getContent' / 'getOutput' processor methods for for-each-output nodes

    const parentId = node.parent_id
    if (parentId === null) {
      throw new Error("For-each-prev-outputs node must be a child of a for-each node, but current parent is null")
    }
    const parent = service.getById(parentId)
    if (parent.type !== "for-each") {
      throw new Error(
        "For-each-prev-outputs node must be a child of a for-each node, but current parent has type " + parent.type,
      )
    }
    console.log("[ForEachPrevOutputsProcessor] parent", parent)

    const parsedParentContent = JSON.parse(parent.content || "{}") as ForEachNodeContent
    console.log("[ForEachPrevOutputsProcessor] parsedParentContent", parsedParentContent)

    const currentIndex = parsedParentContent.currentIndex ?? 0
    console.log("[ForEachPrevOutputsProcessor] currentIndex", currentIndex)
    if (currentIndex <= 0) {
      return []
    }

    const outputNodes = service.repo.findByParentIdAndType(parentId, "for-each-output")
    if (outputNodes.length !== 1) {
      throw new Error(
        "For-each-prev-outputs node must be a child of a for-each node with exactly single for-each-output node, " +
          "but current parent has " +
          outputNodes.length +
          " for-each-output nodes",
      )
    }
    const outputNodeId = outputNodes[0].id
    console.log("[ForEachPrevOutputsProcessor] outputNodeId", outputNodeId)

    const results: string[] = []
    for (let index = 0; index < currentIndex; index++) {
      const iterationOverrides = (parsedParentContent.overrides || [])[index] || {}
      console.log("[ForEachPrevOutputsProcessor]", index, "iterationOverrides", iterationOverrides)

      const outputOverrides = iterationOverrides[`${outputNodeId}`] || {}
      console.log("[ForEachPrevOutputsProcessor]", index, "outputOverrides", outputOverrides)

      const outputOutput = outputOverrides.content ?? ""
      console.log("[ForEachPrevOutputsProcessor]", index, "outputOutput", outputOutput)
      results.push(outputOutput)
    }
    console.log("[ForEachPrevOutputsProcessor] results", results)
    return results
  }
}
