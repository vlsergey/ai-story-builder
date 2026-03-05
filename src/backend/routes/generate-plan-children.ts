import express, { Request, Response, Router } from 'express'
import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiConfigStore } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
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

const router: Router = express.Router()

// POST /generate-plan-children
router.post('/generate-plan-children', express.json(), async (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  const { prompt, parentTitle, parentContent, isRoot, includeExistingLore, model: requestedModel, webSearch, maxTokens, maxCompletionTokens } = req.body as {
    prompt?: string
    parentTitle?: string
    parentContent?: string
    isRoot?: boolean
    includeExistingLore?: boolean
    model?: string
    webSearch?: string
    maxTokens?: number
    maxCompletionTokens?: number
  }
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

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  const sse = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  let accumulated = ''
  let lastEmittedJson = ''
  const onDelta = (chunk: string) => {
    accumulated += chunk
    const parsed = parseMarkdownOutline(accumulated)
    const json = JSON.stringify(parsed)
    if (json === lastEmittedJson) return
    lastEmittedJson = json
    sse('partial_json', parsed)
  }

  try {
    const { response_id } = await adapter.generateResponse(
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
    sse('done', response_id ? { response_id } : {})
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : undefined
    console.error('[generate-plan-children] error:', stack ?? message)
    sse('error', { message, stack })
  }
  res.end()
})

export default router
