import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiSettings } from '../../shared/ai-settings.js'
import type { AiConfigStore } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { PlanEdgeRepository } from '../plan/edges/plan-edge-repository.js'
import { PlanNodeRepository } from '../plan/nodes/plan-node-repository.js'

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

export async function generatePlan(
  params: { prompt?: string; mode?: string; baseContent?: string; settings?: AiSettings; nodeId?: number },
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

  const { prompt, mode, baseContent, settings = {}, nodeId } = params
  const { model: requestedModel, webSearch, includeExistingLore, maxTokens, maxCompletionTokens } = settings
  if (!prompt?.trim()) throw makeError('prompt is required', 400)

  let finalPrompt = prompt.trim()
  if (nodeId !== undefined) {
    try {
      const edgeRepo = new PlanEdgeRepository()
      const edge = edgeRepo.getFirstByToNodeIdAndType(nodeId, 'text')
      if (edge) {
        const nodeRepo = new PlanNodeRepository()
        const fromNode = nodeRepo.getById(edge.from_node_id)
        if (fromNode) {
          const placeholder = `{{${fromNode.title}}}`
          const content = fromNode.content || ''
          finalPrompt = finalPrompt.split(placeholder).join(content)
        }
      }
    } catch (e) {
      console.error('Failed to apply template substitution:', e)
    }
  }

  let engine: string | undefined
  let config: AiConfigStore = {}
  let textLanguage: string | undefined
  const engineFileIds: string[] = []

  try {
    const db = new (Database)(dbPath, { readonly: true })
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

  const adapter = getEngineAdapter(engine)
  if (!adapter) throw makeError(`Plan generation is not supported for engine '${engine}'`, 400)

  const systemPrompt = (mode === 'improve' && baseContent)
    ? `You are a creative writing assistant.\n` +
      `Language: ${textLanguage}.\n` +
      `Write in Markdown format — output the full text, never omit or abbreviate unchanged sections. ` +
      `No explanations, no preamble.\n\n` +
      `<current_text>\n${baseContent}\n</current_text>`
    : `You are a creative writing assistant.\n` +
      `Language: ${textLanguage}.\n` +
      `Write in Markdown format. ` +
      `No explanations, no preamble.`

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
      prompt: finalPrompt,
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
