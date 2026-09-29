import type OpenAI from "openai"
import type { AiGenerationSettings } from "../../shared/ai-generation-settings.js"
import type { PlanNodeRow } from "../../shared/plan-graph.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { getNodePrompts } from "../plan/nodes/graph/settings-helper.js"
import type { NodeInputs } from "../plan/nodes/NodeInput.js"
import { getCurrentEngineDefaultAiGenerationSettings } from "../settings/ai-settings.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { getEngineAdapter } from "./ai-engine-adapter.js"
import { generateWithTelemetry } from "./generate-with-telemetry.js"
import { nodeInputsToReplacements, replaceTemplates } from "./replaceTemplates.js"

/**
 * Writes a text node from its prompts, with `inputs` already resolved by the
 * caller at the node's path: this function never looks a node up itself, so
 * it cannot read another iteration by accident.
 */
export async function generatePlanNodeTextContent(
  abortSignal: AbortSignal,
  node: PlanNodeRow,
  inputs: NodeInputs<string>,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<string> {
  const { userPrompt: aiUserPrompt, systemPrompt: aiSystemPrompt } = getNodePrompts(node.node_type_settings)
  const nodeAiSettings = node.ai_settings

  const finalUserPrompt = replaceTemplates(aiUserPrompt, nodeInputsToReplacements(inputs))
  const finalSystemPrompt = replaceTemplates(aiSystemPrompt, nodeInputsToReplacements(inputs))

  const engineId = SettingsRepository.getCurrentBackend()
  if (!engineId) throw makeErrorWithStatus("no AI engine configured", 400)

  const adapter = getEngineAdapter(engineId)
  if (!adapter) throw makeErrorWithStatus(`Engine ${engineId} not found`, 400)

  const nodeEngineAiSettings =
    (JSON.parse(nodeAiSettings || "{}") as Record<string, AiGenerationSettings>)[engineId] || {}
  const actualAiSettings = {
    ...getCurrentEngineDefaultAiGenerationSettings(),
    ...nodeEngineAiSettings,
  }

  return await generateWithTelemetry({
    engineId,
    adapter,
    request: {
      abortSignal,
      userPrompt: finalUserPrompt,
      systemPrompt: finalSystemPrompt,
      // TODO: fix at some moment, this is very nice to have feature
      includeExistingLore: false,
      aiGenerationSettings: actualAiSettings,
      promptCacheKeys: ["generate-plan-node-text-content", String(node.id)],
      engineFileIds: [],
    },
    instructionsTemplateChars: (aiUserPrompt ?? "").length + (aiSystemPrompt ?? "").length,
    node: { title: node.title, type: node.type },
    onEvent,
  })
}
