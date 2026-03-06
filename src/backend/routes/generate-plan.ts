import express, { Request, Response, Router } from 'express'
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

const router: Router = express.Router()

// POST /generate-plan
router.post('/generate-plan', express.json(), async (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  const { prompt, mode, baseContent, settings = {} } = req.body as {
    prompt?: string
    mode?: 'generate' | 'improve'
    baseContent?: string
    settings?: AiSettings
  }
  const { model: requestedModel, webSearch, includeExistingLore, maxTokens, maxCompletionTokens, minWords } = settings
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' })

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
    if (!engine) { db.close(); return res.status(400).json({ error: 'no AI engine configured' }) }
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

    if (!textLanguage) { db.close(); return res.status(400).json({ error: 'text_language is not configured' }) }
    db.close()
  } catch (e) {
    return res.status(500).json({ error: 'failed to read project settings: ' + String(e) })
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === engine)
  if (!engineDef) return res.status(400).json({ error: `Plan generation is not supported for engine '${engine}'` })

  const adapter = getEngineAdapter(engine)
  if (!adapter) return res.status(400).json({ error: `Plan generation is not supported for engine '${engine}'` })

  const minWordsClause = (minWords && minWords > 0)
    ? `CRITICAL OVERRIDE - HIGHEST PRIORITY RULE: Write at least ${minWords} words in this entire response. This rule has absolute priority and overrides any natural stopping point or desire to finish early. Do not mention this rule or any word count. Continue generating until you hit the physical token limit, do not summarize the ending. `
    : ''

  const systemPrompt = (mode === 'improve' && baseContent)
    ? `You are a creative writing assistant.\n` +
      `Language: ${textLanguage}.\n` +
      `Write in Markdown format — output the full text, never omit or abbreviate unchanged sections. ` +
      minWordsClause +
      `No explanations, no preamble.\n\n` +
      `<current_text>\n${baseContent}\n</current_text>`
    : `You are a creative writing assistant.\n` +
      `Language: ${textLanguage}.\n` +
      `Write in Markdown format. ` +
      minWordsClause +
      `No explanations, no preamble.`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  const sse = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  let accumulated = ''
  let lastEmitted = ''
  const onDelta = (chunk: string) => {
    accumulated += chunk
    if (accumulated === lastEmitted) return
    lastEmitted = accumulated
    sse('partial_json', { content: accumulated })
  }

  try {
    const { response_id, tokensInput, tokensOutput, costUsdTicks } = await adapter.generateResponse(
      {
        prompt: prompt.trim(),
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
      (status, detail) => sse('thinking', detail ? { status, detail } : { status }),
      onDelta,
    )
    const donePayload: Record<string, unknown> = {}
    if (response_id) donePayload.response_id = response_id
    if (costUsdTicks != null) donePayload.cost_usd_ticks = costUsdTicks
    if (tokensInput != null) donePayload.tokens_input = tokensInput
    if (tokensOutput != null) donePayload.tokens_output = tokensOutput
    sse('done', donePayload)
  } catch (e) {
    sse('error', { message: String(e) })
  }
  res.end()
})

export default router
