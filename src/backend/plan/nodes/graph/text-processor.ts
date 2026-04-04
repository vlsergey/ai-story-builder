import { PlanNodeService } from '../plan-node-service.js'
import type { NodeProcessor } from './node-processor.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeStatus, PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import type { TextSettings } from '../../../../shared/node-settings.js'
import { generatePlanNodeTextContent } from '../../../routes/generate-plan-node-text-content.js'
import { AiRegenerateOptions } from '../../../../shared/ai-regenerate-all.js'

/**
 * Processor for 'text' nodes.
 */
export class TextProcessor implements NodeProcessor<TextSettings> {
  readonly supportedTypes: PlanNodeType[] = ['text']
  readonly defaultSettings: TextSettings = {}

  getInputEdgeTypes(): PlanEdgeType[] {
    // Text nodes can have text inputs (for template substitution)
    return ['text']
  }

  getOutputEdgeType(): PlanEdgeType {
    return 'text'
  }

  getOutput(context: PlanNodeService, nodeData: PlanNodeRow): unknown {
    return nodeData.content ?? ''
  }

  async onInputContentChange(context: PlanNodeService, nodeData: PlanNodeRow, changedInputNodeId: number, settings: TextSettings): Promise<PlanNodeUpdate | null> {
    // Check if the changed input is referenced in ai_instructions via template
    const changedNode = context.getById(changedInputNodeId)
    if (!changedNode) {
      return null
    }

    const instructions = nodeData.ai_user_prompt
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
    if (nodeData.status === 'GENERATED') {
      console.log(`[TextProcessor] node ${nodeData.id} depends on changed input ${changedInputNodeId}, marking OUTDATED`)
      return {
        status: 'OUTDATED' as PlanNodeStatus,
      }
    }

    // Otherwise, no change
    return null
  }

  async regenerate(
    context: PlanNodeService,
    regenerateAllOptions: AiRegenerateOptions = {regenerateManual: false},
    node: PlanNodeRow,
    settings: TextSettings
  ): Promise<PlanNodeUpdate | null> {
    // Generate content using AI for text nodes
    console.log(`[TextProcessor] regenerating node ${node.id} (title: ${node.title})`)
    const content = await generatePlanNodeTextContent(node);
    console.log(`[TextProcessor] generated content length: ${content?.length ?? 'null'}`)
    if (content == node.content) return null
    return { content }
  }
}
