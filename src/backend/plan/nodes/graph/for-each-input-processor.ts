import { PlanNodeService } from '../plan-node-service.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import { RegenerationNodeContext } from '../generate/RegenerationContext.js'
import { generateSummary } from '../../../routes/generate-summary.js'

export class ForEachInputProcessor implements NodeProcessor<unknown> {
  readonly defaultSettings = {}

  getOutput(context: PlanNodeService, node: PlanNodeRow): string {
    return node.content ?? ''
  }

  async regenerate(service: PlanNodeService, context: RegenerationNodeContext, node: PlanNodeRow, settings: unknown): Promise<PlanNodeUpdate | null> {
    // we update ONLY summary, since content is copied from for-each input
    if (node.content) {
      return {
        summary: await generateSummary(node.content)
      }
    }
    return null
  }
}
