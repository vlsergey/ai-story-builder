import type { ForEachNodeContent, NodeOverride } from "../../../../shared/for-each-plan-node.js"
import type { ForEachSettings } from "../../../../shared/node-settings.js"
import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import { regenerateSubtreeNodesContents } from "../generate/regenerateTreeNodesContents.js"
import { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

export class ForEachProcessor implements NodeProcessor<ForEachSettings> {
  readonly defaultSettings: ForEachSettings = {}

  getOutput(context: PlanNodeService, node: PlanNodeRow): string[] {
    if ((node.content ?? "").length === 0) return []

    const parsedContent = JSON.parse(node.content || "{}") as ForEachNodeContent

    const outputs = context.findByParentIdAndType(node.id, "for-each-output")
    if (outputs.length === 0) throw Error(`Missing for-each-output node for for-each node ${node.id}`)
    if (outputs.length > 1)
      throw Error(`Too many for-each-output nodes for for-each node ${node.id}: ${outputs.map((i) => i.id)}`)
    const outputNode = outputs[0]

    console.log(
      `[ForEachProcessor] getOutput for node ${node.id}, overrides length: ${parsedContent.overrides?.length || 0}`,
    )
    console.log(`[ForEachProcessor] outputNode.id: ${outputNode.id}, outputNode.content: ${outputNode.content}`)
    if (parsedContent.overrides) {
      parsedContent.overrides.forEach((override, idx) => {
        console.log(`[ForEachProcessor] override[${idx}]:`, override)
        if (override?.[outputNode.id]) {
          console.log(`[ForEachProcessor]   output content: ${override[outputNode.id].content}`)
        } else {
          console.log(`[ForEachProcessor]   output content missing`)
        }
      })
    }

    return (parsedContent.overrides || []).map((override, index) => {
      if (index !== parsedContent.currentIndex) {
        // for non-current pages obtain content from stored overrides
        const outputOverride = override ? override[`${outputNode.id}`] : null
        return outputOverride?.content || ""
      } else {
        // if current page is selected, obtain content from node directly
        return outputNode.content || ""
      }
    })
  }

  async onInputContentChange(
    service: PlanNodeService,
    nodeData: PlanNodeRow,
    changedInputNodeId: number,
    settings: ForEachSettings,
  ): Promise<PlanNodeUpdate | null> {
    const inputs = this.getExpandedInputs(service, nodeData.id)
    const internalInputNodeId = this.getInternalInputNodeId(service, nodeData.id)
    const parsedContent = JSON.parse(nodeData.content || "{}") as ForEachNodeContent
    console.log(
      `[ForEachProcessor] Updating node ${nodeData.id} for new input content (${inputs.length} items) as content overrides for for-each-input node ${internalInputNodeId}`,
    )

    const allChildren = service.findByParentId(nodeData.id)
    const internalInputIdStr = `${internalInputNodeId}`
    const priorOverrides = parsedContent.overrides || []

    // Build a fresh overrides array. For every iteration we explicitly write an
    // entry for every child of the for-each — not just the for-each-input row.
    // This is what lets `applyForEachNodeIterationToChildren` reset user-defined
    // children when navigating to a not-yet-regenerated iteration; otherwise
    // those children would silently retain the previous iteration's GENERATED
    // content and the regen scheduler would skip them.
    const newOverrides: Record<string, NodeOverride>[] = []
    for (let iteration: number = 0; iteration < inputs.length; iteration++) {
      const priorForIter = priorOverrides[iteration] || {}
      const inputUnchanged = priorForIter[internalInputIdStr]?.content === inputs[iteration]

      const overrideForIter: Record<string, NodeOverride> = {}
      for (const child of allChildren) {
        const idStr = `${child.id}`
        if (child.id === internalInputNodeId) {
          overrideForIter[idStr] = {
            content: inputs[iteration],
            summary: null,
            word_count: null,
            char_count: null,
            byte_count: null,
            // mark it outdated to regenerate summary
            status: "OUTDATED",
          }
        } else if (inputUnchanged && priorForIter[idStr]) {
          overrideForIter[idStr] = priorForIter[idStr]
        } else {
          overrideForIter[idStr] = {
            content: null,
            summary: null,
            word_count: null,
            char_count: null,
            byte_count: null,
            status: "OUTDATED",
          }
        }
      }
      newOverrides.push(overrideForIter)
    }

    // replace current input
    await new PlanNodeService().patch(internalInputNodeId, false, {
      content: inputs[parsedContent.currentIndex || 0],
      status: "GENERATED",
    })

    const newContent: ForEachNodeContent = {
      ...parsedContent,
      overrides: newOverrides,
      length: inputs.length,
    }

    return {
      content: JSON.stringify(newContent),
      status: "OUTDATED",
    }
  }

  private getInternalInputNodeId(context: PlanNodeService, nodeId: number): number {
    const internalInputNodes = context.findByParentIdAndType(nodeId, "for-each-input")
    if (internalInputNodes.length === 0) throw Error(`Missing for-each-input node for for-each node ${nodeId}`)
    if (internalInputNodes.length > 1)
      throw Error(`Too many for-each-input nodes for for-each node ${nodeId}: ${internalInputNodes.map((i) => i.id)}`)
    return internalInputNodes[0].id
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    settings: ForEachSettings,
  ): Promise<PlanNodeUpdate | null> {
    const parsedContent = JSON.parse(node.content || "{}") as ForEachNodeContent
    const totalIterations = parsedContent.length || 0

    console.log(`[ForEachProcessor] regenerating node ${node.id}, totalIterations=${totalIterations}`)
    const oldPage = parsedContent.currentIndex || 0

    // Wait for all iterations to complete
    await context.asCycle(totalIterations, async (cycleContext) => {
      for (let iteration: number = 0; iteration < totalIterations; iteration++) {
        await cycleContext.asContainer(iteration, async (childContext) => {
          console.info(
            `Regeneration child nodes content of for-each node ${node.id} '${node.title}' for iteration ${iteration}...`,
          )
          service.changeForEachNodePage(node.id, iteration)
          await regenerateSubtreeNodesContents(childContext, node.id)
          // The just-generated iteration's children are persisted into
          // overrides[iteration] by the next page change — either the next loop
          // iteration's `changeForEachNodePage(iteration+1)` or the final
          // restore-to-oldPage call below. No explicit save needed here.
          console.info(
            `Regeneration child nodes content of for-each node ${node.id} '${node.title}' for iteration ${iteration}... Done`,
          )
        })
      }
    })

    console.log(`[ForEachProcessor] regeneration completed, restoring page to ${oldPage}`)
    return service.changeForEachNodePage(node.id, oldPage)
  }

  async onChildDemoted(service: PlanNodeService, parentNode: PlanNodeRow, childId: number): Promise<void> {
    // Mirror the child's demotion into every iteration's snapshot. The
    // currently-mounted iteration's row was already patched by the caller;
    // here we only touch the override snapshots so navigating to another
    // page doesn't restore GENERATED content for a node whose instructions
    // (or upstream contract) have changed.
    const parsed = (JSON.parse(parentNode.content || "{}") || {}) as ForEachNodeContent
    const overrides = parsed.overrides ?? []
    let changed = false
    for (const ov of overrides) {
      if (!ov) continue
      const entry = ov[`${childId}`]
      if (entry && entry.status === "GENERATED") {
        ov[`${childId}`] = { ...entry, status: "OUTDATED" }
        changed = true
      }
    }
    if (changed) {
      parsed.overrides = overrides
      await service.patch(parentNode.id, false, { content: JSON.stringify(parsed) })
    }
  }

  private getExpandedInputs(context: PlanNodeService, nodeId: number): string[] {
    const nodeInputs = context.findNodeInputs(nodeId)
    const inputs: string[] = []

    for (const nodeInput of nodeInputs) {
      switch (nodeInput.edge.type) {
        case "text":
          inputs.push(nodeInput.input as string)
          break
        case "textArray": {
          const parts = nodeInput.input as string[]
          parts.forEach((part) => {
            inputs.push(part)
          })
          break
        }
      }
    }
    return inputs
  }
}
