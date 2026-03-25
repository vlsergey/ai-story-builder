import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiGenerationSettings } from '../../shared/ai-generation-settings.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { PlanEdgeRepository } from '../plan/edges/plan-edge-repository.js'
import { PlanNodeRepository } from '../plan/nodes/plan-node-repository.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

export async function generatePlan(
  params: { instructions?: string; mode?: string; baseContent?: string; aiGenerationSettings?: AiGenerationSettings; includeExistingLore?: boolean; nodeId?: number },
  onThinking: (status: string, detail?: string) => void,
  onPartialJson: (data: Record<string, unknown>) => void,
): Promise<{
  response_id?: string
  cost_usd_ticks?: number
  tokens_input?: number
  tokens_output?: number
  tokens_total?: number
  cached_tokens?: number
  reasoning_tokens?: number
}> {
  const { instructions, mode, baseContent, aiGenerationSettings = {}, includeExistingLore = false, nodeId } = params
  if (!instructions?.trim()) throw makeError('instructions is required', 400)

  let finalInstructions = instructions.trim()
  if (nodeId !== undefined) {
    const edgeRepo = new PlanEdgeRepository()
    const edges = edgeRepo.getByToNodeIdAndType(nodeId, 'text')
    const nodeRepo = new PlanNodeRepository()
    for (const edge of edges) {
      const fromNode = nodeRepo.getById(edge.from_node_id)
      if (fromNode) {
        const placeholder = `{{${fromNode.title}}}`
        const content = fromNode.content || ''
        finalInstructions = finalInstructions.split(placeholder).join(content)
      }
    }
  }

  // Проверка, что после замены не осталось неразрешённых шаблонов
  const remainingPlaceholders = finalInstructions.match(/\{\{[^}]+?\}\}/g)
  if (remainingPlaceholders && remainingPlaceholders.length > 0) {
    throw makeError(
      `Не удалось разрешить шаблоны: ${remainingPlaceholders.join(', ')}. Убедитесь, что соответствующие узлы существуют.`,
      400
    )
  }

  let engine: string | undefined
  let textLanguage: string | undefined
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.get('current_backend') || undefined
    if (!engine) throw makeError('no AI engine configured', 400)
    textLanguage = SettingsRepository.get('text_language') || undefined

    if (includeExistingLore && engine) {
      const loreRepo = new LoreNodeRepository()
      const nodes = loreRepo.getAllWithAiSyncInfo()
      for (const node of nodes) {
        try {
          const info = JSON.parse(node.ai_sync_info!) as Record<string, { file_id?: string }>
          const fileId = info[engine]?.file_id
          if (fileId) engineFileIds.push(fileId)
        } catch { /* ignore */ }
      }
    }

    if (!textLanguage) throw makeError('text_language is not configured', 400)
  } catch (e: any) {
    if (e.status) throw e
    throw makeError('failed to read project settings: ' + String(e), 500)
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === engine)
  if (!engineDef) throw makeError(`Plan generation is not supported for engine '${engine}'`, 400)

  const adapter = getEngineAdapter(engine)
  if (!adapter) throw makeError(`Plan generation is not supported for engine '${engine}'`, 400)

  let accumulated = ''
  let lastEmitted = ''
  const onDelta = (chunk: string) => {
    accumulated += chunk
    if (accumulated === lastEmitted) return
    lastEmitted = accumulated
    onPartialJson({ content: accumulated })
  }

  const { response_id, tokensInput, tokensOutput, tokensTotal, cachedTokens, reasoningTokens, costUsdTicks } = await adapter.generateResponse(
    {
      instructions: finalInstructions,
      includeExistingLore,
      aiGenerationSettings,
      engineFileIds,
    },
    (status, detail) => onThinking(status, detail),
    onDelta,
  )

  const donePayload: Record<string, unknown> = {}
  if (response_id) donePayload.response_id = response_id
  if (costUsdTicks != null) donePayload.cost_usd_ticks = costUsdTicks
  if (tokensInput != null) donePayload.tokens_input = tokensInput
  if (tokensOutput != null) donePayload.tokens_output = tokensOutput
  if (tokensTotal != null) donePayload.tokens_total = tokensTotal
  if (cachedTokens != null) donePayload.cached_tokens = cachedTokens
  if (reasoningTokens != null) donePayload.reasoning_tokens = reasoningTokens

  return donePayload as {
    response_id?: string
    cost_usd_ticks?: number
    tokens_input?: number
    tokens_output?: number
    tokens_total?: number
    cached_tokens?: number
    reasoning_tokens?: number
  }
}
