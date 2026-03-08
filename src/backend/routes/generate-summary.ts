import express, { Request, Response, Router } from 'express'
import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiSettings } from '../../shared/ai-settings.js'
import type { AiConfigStore, JsonSchemaSpec } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

// POST /api/ai/generate-summary
router.post('/generate-summary', express.json(), async (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  const { node_id, content } = req.body as {
    node_id?: number
    content?: string
  }
  if (!node_id) return res.status(400).json({ error: 'node_id is required' })

  let engine: string | undefined
  let config: AiConfigStore = {}
  let textLanguage: string | undefined
  let nodeContent: string = ''
  const engineFileIds: string[] = [] // we will not include lore files (includeExistingLore = false)

  try {
    const db = new (Database as typeof import('better-sqlite3'))(dbPath, { readonly: true })
    const engineRow = db.prepare("SELECT value FROM settings WHERE key = 'current_backend'").get() as { value: string } | undefined
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string } | undefined
    const langRow = db.prepare("SELECT value FROM settings WHERE key = 'text_language'").get() as { value: string } | undefined
    const autoSummarySetting = db.prepare("SELECT value FROM settings WHERE key = 'auto_generate_summary'").get() as { value: string } | undefined

    engine = engineRow?.value
    if (!engine) { db.close(); return res.status(400).json({ error: 'no AI engine configured' }) }
    if (configRow) {
      try { config = JSON.parse(configRow.value) as AiConfigStore } catch { /* ignore */ }
    }
    textLanguage = langRow?.value
    const autoGenerate = autoSummarySetting?.value === 'true'
    // If auto-generation is disabled, we still allow manual trigger.
    // Proceed with generation regardless.

    // Fetch node content if not provided
    nodeContent = content ?? ''
    if (nodeContent === '') {
      const node = db.prepare('SELECT content FROM plan_nodes WHERE id = ?').get(node_id) as { content: string | null } | undefined
      nodeContent = node?.content ?? ''
    }
    db.close()
    if (!nodeContent || nodeContent.trim().length === 0) {
      return res.status(400).json({ error: 'plan node content is empty' })
    }
  } catch (e) {
    return res.status(500).json({ error: 'failed to read project settings: ' + String(e) })
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === engine)
  if (!engineDef) return res.status(400).json({ error: `Summary generation is not supported for engine '${engine}'` })

  const adapter = getEngineAdapter(engine)
  if (!adapter) return res.status(400).json({ error: `Summary generation is not supported for engine '${engine}'` })

  // Extract summary-specific settings from engine config
  const engineConfig = config[engine as keyof AiConfigStore] as Record<string, unknown> | undefined
  const summarySettings = engineConfig?.summary_settings as AiSettings | undefined

  const model = summarySettings?.model ?? ''
  const includeExistingLore = summarySettings?.includeExistingLore ?? false
  const webSearch = summarySettings?.webSearch ?? 'none'
  const maxTokens = summarySettings?.maxTokens
  const maxCompletionTokens = summarySettings?.maxCompletionTokens

  // Construct system prompt for summary generation
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

  try {
    const { response_id, tokensInput, tokensOutput, tokensTotal, cachedTokens, reasoningTokens, costUsdTicks } = await adapter.generateResponse(
      {
        prompt: prompt.trim(),
        systemPrompt,
        model: model || '', // use summary-specific model or default
        includeExistingLore: includeExistingLore,
        webSearch: webSearch,
        engineFileIds,
        engineDef,
        config,
        maxTokens: maxTokens,
        maxCompletionTokens: maxCompletionTokens,
      },
      () => {}, // ignore thinking events
      onDelta,
    )

    // Update the plan node with the generated summary
    if (accumulated.trim().length > 0) {
      try {
        const db = new (Database as typeof import('better-sqlite3'))(dbPath)
        db.prepare(
          'UPDATE plan_nodes SET summary = ?, auto_summary = 1 WHERE id = ?'
        ).run(accumulated.trim(), node_id)
        db.close()
      } catch (updateError) {
        console.error('[generate-summary] Failed to update node summary:', updateError)
        // Do not fail the request, just log
      }
    }

    return res.json({
      summary: accumulated.trim(),
      response_id,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tokens_total: tokensTotal,
      cached_tokens: cachedTokens,
      reasoning_tokens: reasoningTokens,
      cost_usd_ticks: costUsdTicks,
    })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})

export default router