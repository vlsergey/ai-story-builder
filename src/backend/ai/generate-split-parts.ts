import type OpenAI from "openai"
import type { AiGenerationSettings } from "../../shared/ai-generation-settings.js"
import type { SplitSettings } from "../../shared/node-settings.js"
import type { PlanNodeRow } from "../../shared/plan-graph.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { getNodePrompts } from "../plan/nodes/graph/settings-helper.js"
import { PlanNodeService } from "../plan/nodes/plan-node-service.js"
import { getCurrentEngineDefaultAiGenerationSettings } from "../settings/ai-settings.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { getEngineAdapter } from "./ai-engine-adapter.js"
import { generateWithTelemetry } from "./generate-with-telemetry.js"
import { nodeInputsToReplacements, replaceTemplates } from "./replaceTemplates.js"

export function buildSplitResponseSchema(
  partDescription: string | null,
  expectedPartsCount: number | null,
): Record<string, unknown> {
  const items: Record<string, unknown> = { type: "string" }
  if (partDescription && partDescription.trim().length > 0) {
    items.description = partDescription.trim()
  }
  const partsField: Record<string, unknown> = {
    type: "array",
    items,
  }
  if (expectedPartsCount != null && expectedPartsCount > 0) {
    partsField.minItems = expectedPartsCount
    partsField.maxItems = expectedPartsCount
  }
  return {
    type: "object",
    properties: {
      parts: partsField,
    },
    required: ["parts"],
    additionalProperties: false,
  }
}

function readSplitSettings(nodeTypeSettings: string | null): {
  partDescription: string | null
  expectedPartsCount: number | null
} {
  if (!nodeTypeSettings) return { partDescription: null, expectedPartsCount: null }
  try {
    const parsed = JSON.parse(nodeTypeSettings) as Partial<SplitSettings>
    const partDescription = typeof parsed.partDescription === "string" ? parsed.partDescription : null
    let expectedPartsCount: number | null = null
    if (typeof parsed.expectedPartsCount === "string" && parsed.expectedPartsCount.trim().length > 0) {
      const n = Number(parsed.expectedPartsCount.trim())
      if (Number.isInteger(n) && n > 0) expectedPartsCount = n
    }
    return { partDescription, expectedPartsCount }
  } catch {
    return { partDescription: null, expectedPartsCount: null }
  }
}

const SYSTEM_PROMPT_FALLBACK =
  'You are splitting input text into discrete parts. Respond with a JSON object {"parts": [...]} where parts is an array of strings. Each element must be a complete, self-contained piece of the input. Do not add commentary, do not omit content. If the user prompt does not specify a number of parts, choose what is natural.'

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
  const { partDescription, expectedPartsCount } = readSplitSettings(node.node_type_settings)
  const baseSystemPrompt = aiSystemPrompt ? replaceTemplates(aiSystemPrompt, replacements) : SYSTEM_PROMPT_FALLBACK
  const finalSystemPrompt =
    expectedPartsCount != null
      ? `Output EXACTLY ${expectedPartsCount} parts as ${expectedPartsCount} separate elements in the JSON \`parts\` array. The array length must be exactly ${expectedPartsCount} — not fewer, not more, and never a single concatenated string with in-text separators.\n\n${baseSystemPrompt}`
      : baseSystemPrompt
  const responseSchema = buildSplitResponseSchema(partDescription, expectedPartsCount)

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
    const aiResult = await generateWithTelemetry({
      engineId,
      adapter,
      request: {
        abortSignal,
        userPrompt: finalUserPrompt,
        systemPrompt: finalSystemPrompt,
        responseSchema: {
          name: "splitResult",
          schema: responseSchema,
        },
        includeExistingLore: false,
        aiGenerationSettings: actualAiSettings,
        promptCacheKeys: ["generate-split-parts", String(node.id)],
        engineFileIds: [],
      },
      instructionsTemplateChars: (aiUserPrompt ?? "").length + (aiSystemPrompt ?? "").length,
      node: { title: node.title, type: node.type },
      onEvent,
    })
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
