import type OpenAI from "openai"
import type { AiGenerationSettings } from "../../shared/ai-generation-settings.js"
import {
  type FindProblemsResult,
  type FixProblemsPlanNodeSettings,
  FOUND_PROBLEMS_JSON_SCHEMA,
} from "../../shared/fix-problems-plan-node.js"
import type { PlanNodeRow } from "../../shared/plan-graph.js"
import { getEngineAdapter } from "../lib/ai-engine-adapter.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { PlanNodeService } from "../plan/nodes/plan-node-service.js"
import { getCurrentEngineDefaultAiGenerationSettings } from "../settings/ai-settings.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { nodeInputsToReplacements, replaceTemplates } from "./replaceTemplates.js"

export async function findProblems(
  node: PlanNodeRow,
  source: string,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<FindProblemsResult> {
  const planNodeService = new PlanNodeService()
  const settings = JSON.parse(node.node_type_settings || "{}") as FixProblemsPlanNodeSettings

  const nodeAiSettings = node.ai_settings

  const inputs = planNodeService.findNodeInputsByType(node.id, "text")
  const replacements = nodeInputsToReplacements(inputs)

  // Override the source node with the source provided, because it may be not the first iteration
  const sourceNode =
    inputs.length === 1 ? inputs[0] : inputs.find((input) => input.sourceNode.id === settings.sourceNodeIdToFix)
  if (!sourceNode) throw makeErrorWithStatus("No source node found", 400)
  replacements[sourceNode.sourceNode.title] = source

  const finalUserPrompt = replaceTemplates(settings.aiUserInstructionsToFindProblems ?? null, replacements)
  const finalSystemPrompt = replaceTemplates(settings.aiSystemInstructionsToFindProblems ?? null, replacements)

  const engineFileIds: string[] = []

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

  const aiResult = await adapter.generateResponse(
    {
      userPrompt: finalUserPrompt,
      systemPrompt: finalSystemPrompt,
      responseSchema: {
        name: "fixProblemsFoundProblemsSchema",
        schema: FOUND_PROBLEMS_JSON_SCHEMA,
      },
      // TODO: fix at some moment, this is very nice to have feature
      includeExistingLore: false,
      aiGenerationSettings: actualAiSettings,
      promptCacheKeys: ["generate-plan-node-text-content", String(node.id)],
      engineFileIds,
    },
    onEvent,
  )
  return JSON.parse(aiResult) as FindProblemsResult
}

export async function fixProblems(
  node: PlanNodeRow,
  source: string,
  foundProblemsTemplateTitle: string,
  foundProblems: FindProblemsResult,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<string> {
  const planNodeService = new PlanNodeService()
  const settings = JSON.parse(node.node_type_settings || "{}") as FixProblemsPlanNodeSettings

  const nodeAiSettings = node.ai_settings

  const inputs = planNodeService.findNodeInputsByType(node.id, "text")
  const replacements = nodeInputsToReplacements(inputs)

  // Override the source node with the source provided, because it may be not the first iteration
  if (source) {
    const sourceNode =
      inputs.length === 1 ? inputs[0] : inputs.find((input) => input.sourceNode.id === settings.sourceNodeIdToFix)
    if (!sourceNode) throw makeErrorWithStatus("No source node found", 400)
    replacements[sourceNode.sourceNode.title] = source
  }
  replacements[foundProblemsTemplateTitle] = JSON.stringify(foundProblems)

  const finalUserPrompt = replaceTemplates(settings.aiUserInstructionsToFixProblems ?? null, replacements)
  const finalSystemPrompt = replaceTemplates(settings.aiSystemInstructionsToFixProblems ?? null, replacements)

  const engineFileIds: string[] = []

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
