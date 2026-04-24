import type OpenAI from "openai"
import type { AiGenerationSettings } from "../../shared/ai-generation-settings.js"
import type { PlanNodeRow } from "../../shared/plan-graph.js"
import { getEngineAdapter } from "../lib/ai-engine-adapter.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { PlanNodeService } from "../plan/nodes/plan-node-service.js"
import { getCurrentEngineDefaultAiGenerationSettings } from "../settings/ai-settings.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { nodeInputsToReplacements, replaceTemplates } from "./replaceTemplates.js"

export async function generatePlanNodeTextContent(
  abortSignal: AbortSignal,
  node: PlanNodeRow,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<string> {
  const planNodeService = new PlanNodeService()
  const { ai_user_prompt: aiUserPrompt, ai_system_prompt: aiSystemPrompt, ai_settings: nodeAiSettings } = node

  const inputs = planNodeService.findNodeInputsByType(node.id, "text")
  const finalUserPrompt = replaceTemplates(aiUserPrompt, nodeInputsToReplacements(inputs))
  const finalSystemPrompt = replaceTemplates(aiSystemPrompt, nodeInputsToReplacements(inputs))

  const engineFileIds: string[] = []
  // try {
  // if (includeExistingLore && engine) {
  //   const loreRepo = new LoreNodeRepository()
  //   const nodes = loreRepo.getAllWithAiSyncInfo()
  //   for (const node of nodes) {
  //     try {
  //       const info = JSON.parse(node.ai_sync_info!) as Record<string, { file_id?: string }>
  //       const fileId = info[engine]?.file_id
  //       if (fileId) engineFileIds.push(fileId)
  //     } catch { /* ignore */ }
  //   }
  // }
  // if (!textLanguage) throw makeError('text_language is not configured', 400)
  // } catch (e: any) {
  //   if (e.status) throw e
  //   throw makeError("failed to read project settings: " + String(e), 500)
  // }

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

  return await adapter.generateResponse(
    {
      abortSignal,
      userPrompt: finalUserPrompt,
      systemPrompt: finalSystemPrompt,
      // TODO: fix at some moment, this is very nice to have feature
      includeExistingLore: false,
      aiGenerationSettings: actualAiSettings,
      promptCacheKeys: ["generate-plan-node-text-content", String(node.id)],
      engineFileIds,
    },
    onEvent,
  )
}
