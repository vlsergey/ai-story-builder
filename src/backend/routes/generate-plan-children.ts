import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiSettings } from '../../shared/ai-settings.js'
import type { AiConfigStore } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

/**
 * Parses a markdown outline where the first block (before any ## heading) is
 * the overview and each ## heading introduces a new subsection.
 */
function parseMarkdownOutline(text: string): { overview: string; items: Array<{ title: string; content: string }> } {
  const parts = text.split(/^## /m)
  const overview = parts[0].trim()
  const items = parts.slice(1).map(part => {
    const newline = part.indexOf('\n')
    if (newline === -1) return { title: part.trim(), content: '' }
    return { title: part.slice(0, newline).trim(), content: part.slice(newline + 1).trim() }
  })
  return { overview, items }
}

export async function generatePlanChildren(
  params: { prompt?: string; parentTitle?: string; parentContent?: string; isRoot?: boolean; settings?: AiSettings },
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
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)

  const { prompt, parentTitle, parentContent, isRoot, settings = {} } = params
  const { model: requestedModel, webSearch, includeExistingLore, maxTokens, maxCompletionTokens } = settings
  if (!prompt?.trim()) throw makeError('prompt is required', 400)

  let engine: string | undefined
  let config: AiConfigStore = {}
  let textLanguage: string | undefined
  const engineFileIds: string[] = []

  try {
    const db = new (Database as typeof import('better-sqlite3'))(dbPath, { readonly: true })
    const engineRow = db.prepare("SELECT value FROM settings WHERE key = 'current_backend'").get() as { value: string } | undefined
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string } | undefined
    const langRow = db.prepare("SELECT value FROM settings WHERE key = 'text_language'").get() as { value: string } | undefined

    engine = engineRow?.value
    if (!engine) { db.close(); throw makeError('no AI engine configured', 400) }
    if (configRow) {
      try { config = JSON.parse(configRow.value) as AiConfigStore } catch { /* ignore */ }
    }
    textLanguage = langRow?.value

    if (includeExistingLore && engine) {
      const nodes = db.prepare(
        'SELECT ai_sync_info FROM lore_nodes WHERE ai_sync_info IS NOT NULL AND to_be_deleted = 0'
      ).all() as { ai_sync_info: string }[]
      for (const node of nodes) {
        try {
          const info = JSON.parse(node.ai_sync_info) as Record<string, { file_id?: string }>
          const fileId = info[engine]?.file_id
          if (fileId) engineFileIds.push(fileId)
        } catch { /* ignore */ }
      }
    }

    if (!textLanguage) { db.close(); throw makeError('text_language is not configured', 400) }
    db.close()
  } catch (e: any) {
    if (e.status) throw e
    throw makeError('failed to read project settings: ' + String(e), 500)
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === engine)
  if (!engineDef) throw makeError(`Plan generation is not supported for engine '${engine}'`, 400)

  const adapter = getEngineAdapter(engine!)
  if (!adapter) throw makeError(`Plan generation is not supported for engine '${engine}'`, 400)

  const sectionTitle = parentTitle?.trim() || 'Untitled'
  const parentContext = parentContent?.trim()
    ? `\n\n<current_content>\n${parentContent.trim()}\n</current_content>`
    : ''

  const systemPrompt = isRoot
    ? `You are a creative writing assistant.\n` +
      `Language: ${textLanguage}.\n` +
      `No explanations, no preamble — respond in Markdown only.` +
      parentContext
    : `You are a creative writing assistant.\n` +
      `Language: ${textLanguage}.\n` +
      `Your task is to produce a **detailed breakdown** of the section titled "${sectionTitle}".\n` +
      `Begin with a brief synopsis of this section as a whole (no heading).\n` +
      `Then use ## Markdown headings for each logically coherent subsection.\n` +
      `Under each heading write a rich body: scene descriptions, character motivations, dialogue hints, pacing notes — enough detail that a writer can start drafting directly from it.\n` +
      `No explanations, no preamble — respond in Markdown only.` +
      parentContext

  let accumulated = ''
  let lastEmittedJson = ''
  const onDelta = (chunk: string) => {
    accumulated += chunk
    const parsed = parseMarkdownOutline(accumulated)
    const json = JSON.stringify(parsed)
    if (json === lastEmittedJson) return
    lastEmittedJson = json
    onPartialJson(parsed as unknown as Record<string, unknown>)
  }

  const { response_id, tokensInput, tokensOutput, tokensTotal, cachedTokens, reasoningTokens, costUsdTicks } = await adapter.generateResponse(
    {
      prompt: prompt!.trim(),
      systemPrompt,
      model: requestedModel?.trim() ?? '',
      includeExistingLore: includeExistingLore ?? false,
      webSearch: webSearch ?? 'none',
      engineFileIds,
      engineDef,
      config,
      maxTokens: maxTokens ?? undefined,
      maxCompletionTokens: maxCompletionTokens ?? undefined,
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
