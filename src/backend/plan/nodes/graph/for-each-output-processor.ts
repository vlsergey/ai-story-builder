import { PlanNodeService } from '../plan-node-service.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import { AiRegenerateOptions } from '../../../../shared/ai-regenerate-all.js'

export class ForEachOutputProcessor implements NodeProcessor<unknown> {
  readonly supportedTypes: PlanNodeType[] = ['for-each-output']
  readonly defaultSettings = {}

  getInputEdgeTypes(): PlanEdgeType[] {
    return ['text']
  }

  getOutputEdgeType(): PlanEdgeType {
    return 'text'
  }

  getOutput(context: PlanNodeService, node: PlanNodeRow): unknown {
    return node.content ?? ''
  }

  async onInputContentChange(
    context: PlanNodeService,
    node: PlanNodeRow,
  ): Promise<PlanNodeUpdate | null> {
    const nodeInputs = context.getNodeInputs(node.id)
    let content: string = ''
    for (const {input} of nodeInputs) {
      if (typeof input === 'string') {
        content += input
      }
    }
    const summary = nodeInputs.length == 1 ? nodeInputs[0].sourceNode.summary : undefined

    if (node.content !== content) {
      return {
        content,
        summary,
      }
    }
    return null
  }

  async regenerate(context: PlanNodeService, regenerateAllOptions: AiRegenerateOptions, node: PlanNodeRow, settings: unknown): Promise<PlanNodeRow> {
    const nodeInputs = context.getNodeInputs(node.id)
    let content: string = ''
    for (const {input} of nodeInputs) {
      if (typeof input === 'string') {
        content += input
      }
    }
    const summary = nodeInputs.length == 1 ? nodeInputs[0].sourceNode.summary : undefined

    if (node.content !== content) {
      return {
        ...node,
        content,
        summary: summary || node.summary,
      }
    }
    return node
  }
}

