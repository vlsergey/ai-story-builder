import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import type { ForEachSettings } from '../../../../shared/node-settings.js'
import { ForEachNodeContent } from '../../../../shared/for-each-plan-node.js'
import { PlanNodeService } from '../plan-node-service.js'
import { RegenerationNodeContext } from '../generate/RegenerationContext.js'
import { regenerateSubtreeNodesContents } from '../generate/regenerateTreeNodesContents.js'

export class ForEachProcessor implements NodeProcessor<ForEachSettings> {
  readonly defaultSettings: ForEachSettings = {}

  getOutput(context: PlanNodeService, node: PlanNodeRow): string[] {
    if ((node.content ?? '').length == 0) return []

    const parsedContent = JSON.parse(node.content || '{}') as ForEachNodeContent

    const outputs = context.findByParentIdAndType(node.id, 'for-each-output')
    if (outputs.length == 0) throw Error(`Missing for-each-output node for for-each node ${node.id}`)
    if (outputs.length > 1) throw Error(`Too many for-each-output nodes for for-each node ${node.id}: ${outputs.map(i => i.id)}`)
    const outputNode = outputs[0]

    return (parsedContent.overrides || []).map((override, index) => {
      if (index != parsedContent.currentIndex) {
        // for non-current pages obtain content from stored overrides
        return (override || {})[`${outputNode.id}`].content || ''
      } else {
        // if current page is selected, obtain content from node directly
        return outputNode.content || ''
      }
    })
  }

  async onInputContentChange(
    service: PlanNodeService,
    nodeData: PlanNodeRow,
    changedInputNodeId: number,
    settings: ForEachSettings
  ): Promise<PlanNodeUpdate | null> {
    const inputs = this.getExpandedInputs(service, nodeData.id)
    const internalInputNodeId = this.getInternalInputNodeId(service, nodeData.id)
    const parsedContent = JSON.parse(nodeData.content || '{}') as ForEachNodeContent
    console.log(`[ForEachProcessor] Updating node ${nodeData.id} for new input content (${inputs.length} items) as content overrides for for-each-input node ${internalInputNodeId}`)

    let newOverrides = [...(parsedContent.overrides || [])]
    for (let iteration: number = 0; iteration < inputs.length; iteration++) {
      newOverrides[iteration] = {
        ...newOverrides[iteration],
        [`${internalInputNodeId}`]: {
          ...(newOverrides[iteration] || {})[`${internalInputNodeId}`],
          content: inputs[iteration],
          status: 'GENERATED',
        }
      }
    }

    // replace current input
    await (new PlanNodeService()).patch(internalInputNodeId, false, {
      content: inputs[ parsedContent.currentIndex || 0 ],
      status: 'GENERATED',
    })

    const newContent : ForEachNodeContent = {
      ...parsedContent,
      overrides: newOverrides,
      length: inputs.length,
    }

    return {
      content: JSON.stringify(newContent),
      status: 'OUTDATED',
    }
  }

  private getInternalInputNodeId(context: PlanNodeService, nodeId: number) : number {
    const internalInputNodes = context.findByParentIdAndType(nodeId, 'for-each-input')
    if (internalInputNodes.length == 0) throw Error(`Missing for-each-input node for for-each node ${nodeId}`)
    if (internalInputNodes.length > 1) throw Error(`Too many for-each-input nodes for for-each node ${nodeId}: ${internalInputNodes.map(i => i.id)}`)
    return internalInputNodes[0].id
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    settings: ForEachSettings
  ): Promise<PlanNodeUpdate | null> {
    let parsedContent = JSON.parse(node.content || '{}') as ForEachNodeContent
    const totalIterations = parsedContent.length || 0

    console.log(`[ForEachProcessor] regenerating node ${node.id}`)
    const oldPage = parsedContent.currentIndex || 0

    context.asContainer( totalIterations, async ( childContext ) => {
      for (let iteration: number = 0; iteration < totalIterations; iteration++) {
        console.info(`Regeneration child nodes content of for-each node ${node.id} '${node.title}' for iteration ${iteration}...`)
        service.changeForEachNodePage(node.id, iteration)
        await regenerateSubtreeNodesContents(childContext, node.id)
        console.info(`Regeneration child nodes content of for-each node ${node.id} '${node.title}' for iteration ${iteration}... Done`)
      }
    } )

    return service.changeForEachNodePage(node.id, oldPage)
  }

  private getExpandedInputs(context: PlanNodeService, nodeId: number): string[] {
    const nodeInputs = context.getNodeInputs(nodeId)
    const inputs: string[] = []

    for (const nodeInput of nodeInputs) {
      switch (nodeInput.edge.type) {
        case 'text':
          inputs.push(nodeInput.input as string)
          break;
        case 'textArray':
          const parts = nodeInput.input as string[]
          parts.forEach( part => inputs.push(part))
          break
      }
    }
    return inputs
  }
}
