import type OpenAI from "openai"
import type { AiGenerationSettings } from "../../shared/ai-generation-settings.js"
import type { PlanNodeRow } from "../../shared/plan-graph.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { getNodePrompts } from "../plan/nodes/graph/settings-helper.js"
import { PlanNodeService } from "../plan/nodes/plan-node-service.js"
import { getCurrentEngineDefaultAiGenerationSettings } from "../settings/ai-settings.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { getEngineAdapter } from "./ai-engine-adapter.js"
import { nodeInputsToReplacements, replaceTemplates } from "./replaceTemplates.js"

const SPLIT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    parts: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["parts"],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT_FALLBACK =
  "You are splitting input text into discrete parts. Respond with a JSON object {\"parts\": [...]} where parts is an array of strings. Each element must be a complete, self-contained piece of the input. Do not add commentary, do not omit content. If the user prompt does not specify a number of parts, choose what is natural."

const MAX_ATTEMPTS = 3

export async function generateSplitParts(
  abortSignal: AbortSignal,
  node: PlanNodeRow,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<string[]> {
  const planNodeService = new PlanNodeService()
  const { userPrompt: aiUserPrompt, systemPrompt: aiSystemPrompt } = getNodePrompts(node.node_type_settings)
  const nodeAiSettings = node.ai_settings

  const inputs = planNodeService.findNodeInputsByType(node.id, "text")
  if (inputs.length === 0) {
    return []
  }

  const replacements = nodeInputsToReplacements(inputs)
  const finalUserPrompt = replaceTemplates(aiUserPrompt, replacements)
  const finalSystemPrompt = aiSystemPrompt ? replaceTemplates(aiSystemPrompt, replacements) : SYSTEM_PROMPT_FALLBACK

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

  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (abortSignal.aborted) throw new Error("aborted")
    const aiResult = await adapter.generateResponse(
      {
        abortSignal,
        userPrompt: finalUserPrompt,
        systemPrompt: finalSystemPrompt,
        responseSchema: {
          name: "splitResult",
          schema: SPLIT_RESPONSE_SCHEMA as Record<string, unknown>,
        },
        includeExistingLore: false,
        aiGenerationSettings: actualAiSettings,
        promptCacheKeys: ["generate-split-parts", String(node.id)],
        engineFileIds: [],
      },
      onEvent,
    )
    try {
      const parsed = JSON.parse(aiResult)
      const parts = parsed?.parts
      if (Array.isArray(parts) && parts.every((p) => typeof p === "string")) {
        return parts
      }
      lastError = new Error(`split response is not {parts: string[]}: ${aiResult.slice(0, 200)}`)
    } catch (e) {
      lastError = e
    }
    console.warn(
      `[generateSplitParts] attempt ${attempt + 1}/${MAX_ATTEMPTS} produced invalid JSON for node ${node.id}, retrying`,
      lastError,
    )
  }

  throw new Error(
    `LLM split failed for node ${node.id} after ${MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}
