import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { JsonSchemaSpec } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { PlanNodeRepository } from '../plan/nodes/plan-node-repository.js';
import { SettingsRepository } from '../settings/settings-repository.js'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

// Unused but kept for type compat
void (undefined as unknown as JsonSchemaSpec)

export async function generateSummary(content: string): Promise<string> {
  let engine: string | undefined
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.get('current_backend') || undefined
    if (!engine) throw makeError('no AI engine configured', 400)
  } catch (e: any) {
    if (e.status) throw e
    throw makeError('failed to read project settings: ' + String(e), 500)
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === engine)
  if (!engineDef) throw makeError(`Summary generation is not supported for engine '${engine}'`, 400)

  const adapter = getEngineAdapter(engine)
  if (!adapter) throw makeError(`Summary generation is not supported for engine '${engine}'`, 400)

  const includeExistingLore = false // summary doesn't need lore attachments

  // Get custom summary instructions from engine config
  const generateSummaryInstructions = SettingsRepository.getCurrentEngineGenerateSummaryInstructions()?.trim()
  if (!generateSummaryInstructions) {
    throw makeError('Summary generation is disabled because generateSummaryInstructions is not configured', 400)
  }

  const systemPrompt = generateSummaryInstructions.trim()
  const userPrompt = content.trim()

  return await adapter.generateResponse(
    {
      userPrompt,
      systemPrompt,
      includeExistingLore,
      engineFileIds,
    },
  )
}

export async function updateSummary(planNodeId: number) {
  if (!SettingsRepository.getAutoGenerateSummary()) return

  const planNodeRepository = new PlanNodeRepository()
  const planNode = planNodeRepository.getById(planNodeId)
  if (!planNode) throw makeError(`Plan node ${planNodeId} not found`, 404)

  const newSummary = await generateSummary(planNode.content || '')
  if (newSummary != planNode.summary) {
    planNodeRepository.patch(planNodeId, { summary: newSummary })
  }
}