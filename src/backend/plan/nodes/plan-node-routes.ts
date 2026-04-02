import type { PlanNodeCreate } from '../../../shared/plan-graph.js'
import { isValidNodeType, NODE_TYPES } from '../../../shared/node-edge-dictionary.js'
import { PlanNodeService } from './plan-node-service.js'
import { makeErrorWithStatus } from '../../lib/make-errors.js'

export function createPlanNode(data: PlanNodeCreate): { id: number | bigint } {
  if (!data.title) throw makeErrorWithStatus('title required', 400)
  // Validate type if provided
  if (data.type !== undefined && !isValidNodeType(data.type)) {
    const valid = NODE_TYPES.map(nt => nt.id).join(', ')
    throw makeErrorWithStatus(`Invalid node type "${data.type}". Valid types: ${valid}`, 400)
  }

  const result = new PlanNodeService().create(data)
  return { id: result.id }
}

