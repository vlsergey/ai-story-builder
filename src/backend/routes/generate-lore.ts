import express, { Request, Response, Router } from 'express'
import type OpenAI from 'openai'
import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import { createYandexClient } from '../lib/yandex-client.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

interface YandexConfig {
  api_key?: string
  folder_id?: string
  search_index_id?: string
}

interface AiConfigStore {
  yandex?: YandexConfig
  [key: string]: unknown
}

// ─── POST /generate-lore ───────────────────────────────────────────────────

router.post('/generate-lore', express.json(), async (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  const { prompt, includeExistingLore, model: requestedModel, webSearch } = req.body as {
    prompt?: string
    includeExistingLore?: boolean
    model?: string
    webSearch?: string
  }
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' })

  let engine: string | undefined
  let config: AiConfigStore = {}
  let textLanguage = 'ru-RU'

  // Collect per-engine file IDs from lore nodes (used if KB attachment is unavailable)
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
    if (langRow?.value) textLanguage = langRow.value

    // Pre-collect uploaded file IDs for the active engine (for file-attachment fallback path)
    if (includeExistingLore && engine) {
      const nodes = db.prepare(
        'SELECT ai_sync_info FROM lore_nodes WHERE ai_sync_info IS NOT NULL AND to_be_deleted = 0 AND word_count > 0'
      ).all() as { ai_sync_info: string }[]
      for (const node of nodes) {
        try {
          const info = JSON.parse(node.ai_sync_info) as Record<string, { file_id?: string }>
          const fileId = info[engine]?.file_id
          if (fileId) engineFileIds.push(fileId)
        } catch { /* ignore */ }
      }
    }

    db.close()
  } catch (e) {
    return res.status(500).json({ error: 'failed to read project settings: ' + String(e) })
  }

  if (engine !== 'yandex') {
    return res.status(400).json({ error: `Lore generation is not supported for engine '${engine}'` })
  }

  const apiKey = config.yandex?.api_key?.trim()
  const folderId = config.yandex?.folder_id?.trim()
  if (!apiKey || !folderId) {
    return res.status(400).json({ error: 'Yandex api_key and folder_id are required' })
  }

  const systemPrompt =
    `You are a creative writing assistant. Generate a lore item for a story.\n` +
    `Write the result in Markdown format. Language: ${textLanguage}.\n` +
    `Respond with only the lore content — no explanations, no preamble.`

  const model = requestedModel?.trim() || `gpt://${folderId}/yandexgpt/latest`
  const client = createYandexClient(apiKey, folderId)

  try {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt.trim() },
      ],
    }

    const tools: unknown[] = []

    if (includeExistingLore) {
      const caps = BUILTIN_ENGINES.find(e => e.id === engine)?.capabilities
      const searchIndexId = config.yandex?.search_index_id

      if (caps?.knowledgeBaseAttachment && searchIndexId) {
        tools.push({ type: 'file_search', file_search: { vector_store_ids: [searchIndexId] } })
      }
      // fileAttachment fallback path: placeholder for future per-engine implementation.
    }

    if (webSearch && webSearch !== 'none') {
      tools.push({ type: 'web_search', web_search: { search_context_size: webSearch } })
    }

    if (tools.length > 0) {
      ;(requestParams as unknown as Record<string, unknown>)['tools'] = tools
    }

    const completion = await client.chat.completions.create(requestParams)
    const content = completion.choices[0]?.message?.content ?? ''
    return res.json({ content })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})

export default router
