import { PlanNodeService } from '../plan-node-service.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeRow } from '../../../../shared/plan-graph.js'

export class ForEachInputProcessor implements NodeProcessor<unknown> {
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
}

