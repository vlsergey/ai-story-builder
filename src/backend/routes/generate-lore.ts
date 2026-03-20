import { parse as parsePartialJson } from 'best-effort-json-parser'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiGenerationSettings } from '../../shared/ai-generation-settings.js'
import type { JsonSchemaSpec } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

const LORE_RESPONSE_SCHEMA: JsonSchemaSpec = {
  name: 'lore_node',
  description: 'A lore item with a short name and content in markdown format',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short name or title for the lore item (1–10 words) in plain text' },
      content: { type: 'string', description: 'Full content of the lore item in markdown format' },
    },
    required: ['name', 'content'],
    additionalProperties: false,
  },
}

export interface GenerateLoreParams {
  prompt?: string
  mode?: 'generate' | 'improve'
  baseContent?: string
  aiGenerationSettings?: AiGenerationSettings
  includeExistingLore?: boolean
}

export async function generateLore(
  params: GenerateLoreParams,
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
  const { prompt, mode, baseContent, aiGenerationSettings = {}, includeExistingLore = false } = params
  const responseSchema = LORE_RESPONSE_SCHEMA
  if (!prompt?.trim()) throw makeError('prompt is required', 400)

  let engine: string | undefined
  let textLanguage: string | null
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.get('current_backend') || undefined
    if (!engine) throw makeError('no AI engine configured', 400)

    textLanguage = SettingsRepository.getTextLanguage()

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
  if (!engineDef) {
    throw makeError(`Lore generation is not supported for engine '${engine}'`, 400)
  }

  const adapter = getEngineAdapter(engine)
  if (!adapter) {
    throw makeError(`Lore generation is not supported for engine '${engine}'`, 400)
  }

  const systemPrompt = (mode === 'improve' && baseContent)
    ? `You are a creative writing assistant. Improve the following lore item according to the user's instructions.\n` +
      `Language: ${textLanguage}.\n` +
      `Respond with a JSON object matching the provided schema. Refine the name only if necessary. ` +
      `Output the full improved text in Markdown format — never omit or abbreviate any part of the text, even unchanged sections. No explanations, no preamble.\n\n` +
      `Current text:\n<current_text>\n${baseContent}\n</current_text>`
    : `You are a creative writing assistant. Generate a lore item for a story.\n` +
      `Language: ${textLanguage}.\n` +
      `Respond with a JSON object matching the provided schema. No explanations, no preamble.`

  let accumulated = ''
  let lastEmittedJson = ''
  const onDelta = (chunk: string) => {
    accumulated += chunk
    const partial = parsePartialJson(accumulated) as Record<string, unknown>
    const json = JSON.stringify(partial)
    if (json === lastEmittedJson) return
    lastEmittedJson = json
    onPartialJson(partial)
  }

  const { response_id, tokensInput, tokensOutput, tokensTotal, cachedTokens, reasoningTokens, costUsdTicks } = await adapter.generateResponse(
    {
      prompt: prompt.trim(),
      systemPrompt,
      includeExistingLore,
      aiGenerationSettings,
      engineFileIds,
      responseSchema,
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
