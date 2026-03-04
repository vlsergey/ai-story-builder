import express, { Request, Response, Router } from 'express'
import OpenAI from 'openai'
import { getCurrentDbPath } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

const YANDEX_BASE = 'https://ai.api.cloud.yandex.net/v1'

interface YandexConfig {
  api_key?: string
  folder_id?: string
  models?: string
  search_index_id?: string
}

interface AiConfigStore {
  yandex?: YandexConfig
  [key: string]: unknown
}

function createYandexClient(apiKey: string, folderId: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: YANDEX_BASE,
    project: folderId,
    defaultHeaders: { 'x-folder-id': folderId },
  })
}

router.post('/generate-lore', express.json(), async (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  const { prompt, includeExistingLore } = req.body as { prompt?: string; includeExistingLore?: boolean }
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' })

  let engine: string | undefined
  let config: AiConfigStore = {}
  let textLanguage = 'ru-RU'

  try {
    const db = new (Database as typeof import('better-sqlite3'))(dbPath, { readonly: true })
    const engineRow = db.prepare("SELECT value FROM settings WHERE key = 'current_backend'").get() as { value: string } | undefined
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string } | undefined
    const langRow = db.prepare("SELECT value FROM settings WHERE key = 'text_language'").get() as { value: string } | undefined
    db.close()

    engine = engineRow?.value
    if (!engine) return res.status(400).json({ error: 'no AI engine configured' })

    if (configRow) {
      try { config = JSON.parse(configRow.value) as AiConfigStore } catch { /* ignore */ }
    }

    if (langRow?.value) textLanguage = langRow.value
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

  const model = config.yandex?.models?.split(',')[0]?.trim() || 'yandexgpt-lite'
  const searchIndexId = config.yandex?.search_index_id

  const client = createYandexClient(apiKey, folderId)

  try {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt.trim() },
      ],
    }

    if (includeExistingLore && searchIndexId) {
      // Attach Yandex search tool for knowledge base retrieval
      ;(requestParams as Record<string, unknown>)['tools'] = [
        { searchIndex: { searchIndexIds: [searchIndexId] } },
      ]
    }

    const completion = await client.chat.completions.create(requestParams)
    const content = completion.choices[0]?.message?.content ?? ''
    return res.json({ content })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})

export default router
