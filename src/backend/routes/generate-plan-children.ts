import express, { Request, Response, Router } from 'express'
import { parse as parsePartialJson } from 'best-effort-json-parser'
import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiConfigStore, JsonSchemaSpec } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'

const PLAN_CHILDREN_SCHEMA: JsonSchemaSpec = {
  name: 'plan_children',
  description: 'A structured list of child plan nodes to be created under a parent plan node',
  schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Updated overview/description for the parent plan node',
      },
      items: {
        type: 'array',
        description: 'List of child plan nodes to create',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short title for the child node (1–10 words)' },
            description: { type: 'string', description: 'Detailed content for this child node in markdown format (~500–1000 words)' },
          },
          required: ['name', 'description'],
          additionalProperties: false,
        },
      },
    },
    required: ['description', 'items'],
    additionalProperties: false,
  },
}

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

// POST /generate-plan-children
router.post('/generate-plan-children', express.json(), async (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  const { prompt, parentTitle, parentContent, model: requestedModel, webSearch } = req.body as {
    prompt?: string
    parentTitle?: string
    parentContent?: string
    model?: string
    webSearch?: string
  }
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' })

  let engine: string | undefined
  let config: AiConfigStore = {}
  let textLanguage: string | undefined

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
    if (!textLanguage) { db.close(); return res.status(400).json({ error: 'text_language is not configured' }) }
    db.close()
  } catch (e) {
    return res.status(500).json({ error: 'failed to read project settings: ' + String(e) })
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === engine)
  if (!engineDef) return res.status(400).json({ error: `Plan generation is not supported for engine '${engine}'` })

  const adapter = getEngineAdapter(engine)
  if (!adapter) return res.status(400).json({ error: `Plan generation is not supported for engine '${engine}'` })

  const parentContext = parentContent?.trim()
    ? `\n\nParent node current content:\n<parent_content>\n${parentContent}\n</parent_content>`
    : ''

  const systemPrompt =
    `You are a creative writing assistant helping to structure a story plan.\n` +
    `Language: ${textLanguage}.\n` +
    `The user wants to create/split a plan node titled "${parentTitle ?? 'Plan node'}" into sub-items.\n` +
    `Each item should have a concise title and a detailed description in Markdown format.\n` +
    `Respond with a JSON object matching the provided schema. No explanations, no preamble.` +
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
    const partial = parsePartialJson(accumulated) as Record<string, unknown>
    const json = JSON.stringify(partial)
    if (json === lastEmittedJson) return
    lastEmittedJson = json
    sse('partial_json', partial)
  }

  try {
    const { response_id } = await adapter.generateResponse(
      {
        prompt: prompt.trim(),
        systemPrompt,
        model: requestedModel?.trim() ?? '',
        includeExistingLore: false,
        webSearch: webSearch ?? 'none',
        engineFileIds: [],
        engineDef,
        config,
        responseSchema: PLAN_CHILDREN_SCHEMA,
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
