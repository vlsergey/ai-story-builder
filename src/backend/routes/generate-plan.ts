import express, { Request, Response, Router } from 'express'
import { parse as parsePartialJson } from 'best-effort-json-parser'
import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiConfigStore, JsonSchemaSpec } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'

const PLAN_RESPONSE_SCHEMA: JsonSchemaSpec = {
  name: 'plan_node',
  description: 'A plan node with a short title and content in markdown format',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the plan node (1–10 words)' },
      content: { type: 'string', description: 'Full content of the plan node in markdown format' },
    },
    required: ['title', 'content'],
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

// POST /generate-plan
router.post('/generate-plan', express.json(), async (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  const { prompt, includeExistingLore, model: requestedModel, webSearch, mode, baseContent } = req.body as {
    prompt?: string
    includeExistingLore?: boolean
    model?: string
    webSearch?: string
    mode?: 'generate' | 'improve'
    baseContent?: string
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

  const systemPrompt = (mode === 'improve' && baseContent)
    ? `You are a creative writing assistant. Improve the following plan node according to the user's instructions.\n` +
      `Language: ${textLanguage}.\n` +
      `Respond with a JSON object matching the provided schema. Refine the title only if necessary. ` +
      `Output the full improved text in Markdown format — never omit or abbreviate any part of the text, even unchanged sections. No explanations, no preamble.\n\n` +
      `Current text:\n<current_text>\n${baseContent}\n</current_text>`
    : `You are a creative writing assistant. Generate a plan node for a story.\n` +
      `Language: ${textLanguage}.\n` +
      `Respond with a JSON object matching the provided schema. No explanations, no preamble.`

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
        includeExistingLore: includeExistingLore ?? false,
        webSearch: webSearch ?? 'none',
        engineFileIds,
        engineDef,
        config,
        responseSchema: PLAN_RESPONSE_SCHEMA,
      },
      (status, detail) => sse('thinking', detail ? { status, detail } : { status }),
      onDelta,
    )
    sse('done', response_id ? { response_id } : {})
  } catch (e) {
    sse('error', { message: String(e) })
  }
  res.end()
})

export default router
