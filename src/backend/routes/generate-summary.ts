import { BUILTIN_ENGINES } from '../../shared/ai-engines'
import type { JsonSchemaSpec } from '../lib/ai-engine-adapter'
import { getEngineAdapter } from '../lib/ai-engine-adapter'
import { SettingsRepository } from '../settings/settings-repository'
import { PlanNodeRepository } from '../plan/nodes/plan-node-repository'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

// Unused but kept for type compat
void (undefined as unknown as JsonSchemaSpec)

export async function generateSummary(params: { node_id?: number; content?: string }): Promise<{
  summary: string
  response_id?: string
  tokens_input?: number
  tokens_output?: number
  tokens_total?: number
  cached_tokens?: number
  reasoning_tokens?: number
  cost_usd_ticks?: number
}> {
  const { node_id, content } = params
  if (!node_id) throw makeError('node_id is required', 400)

  const nodeRepo = new PlanNodeRepository()

  let engine: string | undefined
  let textLanguage: string | undefined
  let nodeContent: string = ''
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.get('current_backend') || undefined
    if (!engine) throw makeError('no AI engine configured', 400)
    textLanguage = SettingsRepository.get('text_language') || undefined

    nodeContent = content ?? ''
    if (nodeContent === '') {
      const node = nodeRepo.getById(node_id)
      nodeContent = node?.content ?? ''
    }
    if (!nodeContent || nodeContent.trim().length === 0) {
      throw makeError('plan node content is empty', 400)
    }
  } catch (e: any) {
    if (e.status) throw e
    throw makeError('failed to read project settings: ' + String(e), 500)
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === engine)
  if (!engineDef) throw makeError(`Summary generation is not supported for engine '${engine}'`, 400)

  const adapter = getEngineAdapter(engine)
  if (!adapter) throw makeError(`Summary generation is not supported for engine '${engine}'`, 400)

  const includeExistingLore = false // summary doesn't need lore attachments

  const systemPrompt = `You are a concise summarization assistant.
Language: ${textLanguage}.
Generate a short summary of the provided text, 5–10 words, in the same language as the text.
Do not include any explanations, introductions, or meta-commentary.
Output only the summary text.`

  const prompt = `Summarize the following text in 5–10 words:\n\n${nodeContent}`

  let accumulated = ''
  const onDelta = (chunk: string) => {
    accumulated += chunk
  }

  const { response_id, tokensInput, tokensOutput, tokensTotal, cachedTokens, reasoningTokens, costUsdTicks } = await adapter.generateResponse(
    {
      prompt: prompt.trim(),
      systemPrompt,
      includeExistingLore,
      engineFileIds,
    },
    () => {}, // ignore thinking events
    onDelta,
  )

  // Update the plan node with the generated summary
  if (accumulated.trim().length > 0) {
    try {
      nodeRepo.updateSummary(node_id, accumulated.trim(), 1)
    } catch (updateError) {
      console.error('[generate-summary] Failed to update node summary:', updateError)
    }
  }

  return {
    summary: accumulated.trim(),
    response_id,
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    tokens_total: tokensTotal,
    cached_tokens: cachedTokens,
    reasoning_tokens: reasoningTokens,
    cost_usd_ticks: costUsdTicks,
  }
}
