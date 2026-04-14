import type { AiGenerationSettings } from "../../shared/ai-generation-settings.js"
import type { PlanEdgeRow, PlanNodeRow } from "../../shared/plan-graph.js"
import { getEngineAdapter } from "../lib/ai-engine-adapter.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import type OpenAI from "openai"

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

export async function generatePlanNodeTextContent(
  node: PlanNodeRow,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<string> {
  const edgeRepo = new PlanEdgeRepository()

  const { ai_user_prompt: aiUserPrompt, ai_system_prompt: aiSystemPrompt, ai_settings: nodeAiSettings } = node

  const edges = edgeRepo.getByToNodeIdAndType(node.id, "text")
  const finalUserPrompt = replaceTemplates(aiUserPrompt, edges)
  const finalSystemPrompt = replaceTemplates(aiSystemPrompt, edges)

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
  if (!engineId) throw makeError("no AI engine configured", 400)

  const adapter = getEngineAdapter(engineId)
  if (!adapter) throw makeError(`Engine ${engineId} not found`, 400)

  const nodeEngineAiSettings =
    (JSON.parse(nodeAiSettings || "{}") as Record<string, AiGenerationSettings>)[engineId] || {}
  const actualAiSettings = {
    ...SettingsRepository.getCurrentEngineDefaultAiGenerationSettings(),
    ...nodeEngineAiSettings,
  }

  return await adapter.generateResponse(
    {
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

function replaceTemplates<T extends string | null>(content: string | null, textEdges: PlanEdgeRow[]): T {
  if (!content) return content as T

  const nodeRepo = new PlanNodeRepository()
  let result = (content || "").trim()
  for (const edge of textEdges) {
    const fromNode = nodeRepo.findById(edge.from_node_id)
    if (fromNode) {
      const placeholder = `{{${fromNode.title}}}`
      const content = fromNode.content || ""
      result = result.split(placeholder).join(content)
    }
  }

  // Проверка, что после замены не осталось неразрешённых шаблонов
  const remainingPlaceholders = result.match(/\{\{[^}]+?\}\}/g)
  if (remainingPlaceholders && remainingPlaceholders.length > 0) {
    throw makeError(
      `Не удалось разрешить шаблоны: ${remainingPlaceholders.join(", ")}. ` +
        `Убедитесь, что соответствующие узлы существуют.`,
      400,
    )
  }

  return result as T
}
