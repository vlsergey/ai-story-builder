import { PlanNodeService } from '../plan-node-service.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeStatus, PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import type { TextSettings } from '../../../../shared/node-settings.js'
import { generatePlanNodeTextContent } from '../../../routes/generate-plan-node-text-content.js'
import { RegenerationNodeContext } from '../generate/RegenerationContext.js'

/**
 * Processor for 'text' nodes.
 */
export class TextProcessor implements NodeProcessor<TextSettings> {
  readonly defaultSettings: TextSettings = {}

  getOutput(context: PlanNodeService, nodeData: PlanNodeRow): unknown {
    return nodeData.content ?? ''
  }

  async onInputContentChange(
    service: PlanNodeService,
    data: PlanNodeRow,
    changedInputNodeId: number,
    settings: TextSettings
  ): Promise<PlanNodeUpdate | null> {
    // Check if the changed input is referenced in ai_instructions via template
    const changedNode = service.getById(changedInputNodeId)
    if (!changedNode) {
      return null
    }

    const instructions = data.ai_user_prompt
    if (!instructions) {
      return null
    }

    // Determine if the changed node's title appears as a template placeholder
    const placeholder = `{{${changedNode.title}}}`
    if (!instructions.includes(placeholder)) {
      // This input is not referenced, no need to mark outdated
      return null
    }

    // If node status is GENERATED, mark it as OUTDATED
    if (data.status === 'GENERATED') {
      console.log(`[TextProcessor] node ${data.id} depends on changed input ${changedInputNodeId}, marking OUTDATED`)
      return {
        status: 'OUTDATED' as PlanNodeStatus,
      }
    }

    // Otherwise, no change
    return null
  }

  async regenerate(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    node: PlanNodeRow,
    settings: TextSettings
  ): Promise<PlanNodeUpdate | null> {
    // Generate content using AI for text nodes
    console.log(`[TextProcessor] regenerating node ${node.id} (title: ${node.title})`)
    const content = await generatePlanNodeTextContent(node, (event) => context.onEvent(event))
    console.log(`[TextProcessor] generated content length: ${content?.length ?? 'null'}`)
    if (content == node.content) return null
    return { content }
  }
}
