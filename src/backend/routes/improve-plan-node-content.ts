import type { AiGenerationSettings } from '../../shared/ai-generation-settings.js'
import { PlanNodeRow } from '../../shared/plan-graph.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { PlanNodeRepository } from '../plan/nodes/plan-node-repository.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import OpenAI from 'openai'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

interface ImproveResult {
  oldNode: PlanNodeRow,
  newContent: string,
}

export async function improvePlanNodeContent(
  nodeId: number,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<ImproveResult> {
  const nodeRepo = new PlanNodeRepository()

  const planNode = nodeRepo.getById(nodeId)
  if (!planNode) throw makeError('node not found', 404)

  const {
    ai_improve_instruction: aiImproveInstruction,
    ai_settings: nodeAiSettings,
  } = planNode
  if (!aiImproveInstruction) throw makeError('no ai improve instructions found', 400)

  const systemPrompt = aiImproveInstruction
  const userPrompt = planNode.content || ''

  const engineId = SettingsRepository.getCurrentBackend()
  if (!engineId) throw makeError('no AI engine configured', 400)

  const adapter = getEngineAdapter(engineId)
  if (!adapter) throw makeError(`Engine ${engineId} not found`, 400)

  const nodeEngineAiSettings = (JSON.parse(nodeAiSettings || '{}') as Record<string, AiGenerationSettings>)[engineId] || {}
  const actualAiSettings = {
    ...SettingsRepository.getCurrentEngineDefaultAiGenerationSettings(),
    ...nodeEngineAiSettings
  }

  const newContent = await adapter.generateResponse(
    {
      userPrompt,
      systemPrompt,
      aiGenerationSettings: actualAiSettings,
      // TODO: fix at some moment, this is very nice to have feature
      includeExistingLore: false,
      engineFileIds: [],
    },
    onEvent,
  )

  return {
    oldNode: planNode,
    newContent,
  }
}
