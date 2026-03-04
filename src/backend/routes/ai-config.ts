import express, { Request, Response, Router } from 'express'
import { getCurrentDbPath } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

// ─── Types ────────────────────────────────────────────────────────────────────

interface GrokConfig {
  api_key?: string
}

interface YandexConfig {
  api_key?: string
  folder_id?: string
  models?: string
}

interface AiConfigStore {
  grok?: GrokConfig
  yandex?: YandexConfig
  custom?: Record<string, Record<string, string>>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDb(dbPath: string, readonly = false) {
  if (!Database) throw new Error('SQLite lib missing')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return new Database(dbPath, readonly ? { readonly: true } : undefined)
}

function readAiConfig(dbPath: string): AiConfigStore {
  const db = getDb(dbPath, true)
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'ai_config'")
    .get() as { value: string } | undefined
  db.close()
  if (!row) return {}
  try {
    return JSON.parse(row.value) as AiConfigStore
  } catch {
    return {}
  }
}

function writeAiConfig(dbPath: string, config: AiConfigStore): void {
  const db = getDb(dbPath)
  db
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_config', ?)")
    .run(JSON.stringify(config))
  db.close()
}

// ─── GET /api/ai/config ───────────────────────────────────────────────────────

router.get('/config', (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = getDb(dbPath, true)
    const engineRow = db
      .prepare("SELECT value FROM settings WHERE key = 'current_backend'")
      .get() as { value: string } | undefined
    db.close()

    const config = readAiConfig(dbPath)
    res.json({
      current_engine: engineRow?.value ?? null,
      grok: {
        api_key: config.grok?.api_key ?? '',
      },
      yandex: {
        api_key: config.yandex?.api_key ?? '',
        folder_id: config.yandex?.folder_id ?? '',
        models: config.yandex?.models ?? '',
      },
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ─── POST /api/ai/config ──────────────────────────────────────────────────────
// Saves credential fields for one engine. Merges into existing config.
// Body: { engine: string, fields: Record<string, string> }

router.post('/config', express.json(), (req: Request, res: Response) => {
  const { engine, fields } = req.body as { engine?: string; fields?: Record<string, string> }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  if (!engine || !fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'engine and fields are required' })
  }
  try {
    const config = readAiConfig(dbPath)
    if (engine === 'grok') {
      config.grok = { ...config.grok, ...fields } as GrokConfig
    } else if (engine === 'yandex') {
      config.yandex = { ...config.yandex, ...fields } as YandexConfig
    } else {
      if (!config.custom) config.custom = {}
      config.custom[engine] = { ...(config.custom[engine] ?? {}), ...fields }
    }
    writeAiConfig(dbPath, config)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ─── POST /api/ai/current-engine ─────────────────────────────────────────────
// Sets (or clears) the active AI engine. Validates required credentials first.
// Body: { engine: string | null }

router.post('/current-engine', express.json(), (req: Request, res: Response) => {
  const { engine } = req.body as { engine?: string | null }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  if (engine != null) {
    const config = readAiConfig(dbPath)
    const missing: string[] = []
    if (engine === 'grok') {
      if (!config.grok?.api_key?.trim()) missing.push('api_key')
    } else if (engine === 'yandex') {
      if (!config.yandex?.api_key?.trim()) missing.push('api_key')
      if (!config.yandex?.folder_id?.trim()) missing.push('folder_id')
    }
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields for ${engine}: ${missing.join(', ')}`,
        missing,
      })
    }
  }

  try {
    const db = getDb(dbPath)
    if (engine == null) {
      db.prepare("DELETE FROM settings WHERE key = 'current_backend'").run()
    } else {
      db
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('current_backend', ?)")
        .run(engine)
    }
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ─── POST /api/ai/:engine/test ────────────────────────────────────────────────
// Tests credentials against the real AI provider API.
// Accepts credentials in the request body (current form values, may be unsaved).
// Uses Node.js native fetch (requires Node 18+).

router.post('/:engine/test', express.json(), async (req: Request, res: Response) => {
  const { engine } = req.params
  const creds = req.body as Record<string, string>

  try {
    if (engine === 'grok') {
      const apiKey = creds['api_key']?.trim()
      if (!apiKey) return res.status(400).json({ ok: false, error: 'api_key is required' })

      const r = await fetch('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (r.ok) {
        const data = await r.json() as { data?: unknown[] }
        const count = Array.isArray(data.data) ? data.data.length : 0
        res.json({ ok: true, detail: `Connected. ${count} model(s) available.` })
      } else {
        const body = await r.text()
        res.json({ ok: false, error: `HTTP ${r.status}: ${body}` })
      }

    } else if (engine === 'yandex') {
      const apiKey = creds['api_key']?.trim()
      const folderId = creds['folder_id']?.trim()
      if (!apiKey) return res.status(400).json({ ok: false, error: 'api_key is required' })
      if (!folderId) return res.status(400).json({ ok: false, error: 'folder_id is required' })

      // Use the tokenize endpoint as a lightweight credential check.
      // No listModels endpoint exists in the Yandex Foundation Models API.
      const r = await fetch(
        'https://llm.api.cloud.yandex.net/foundationModels/v1/tokenize',
        {
          method: 'POST',
          headers: {
            Authorization: `Api-Key ${apiKey}`,
            'x-folder-id': folderId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            modelUri: `gpt://${folderId}/yandexgpt-lite/latest`,
            text: 'test',
          }),
        }
      )
      if (r.ok) {
        const data = await r.json() as { tokens?: unknown[] }
        const tokenCount = Array.isArray(data.tokens) ? data.tokens.length : '?'
        res.json({ ok: true, detail: `Connected. Tokenized: ${tokenCount} token(s).` })
      } else {
        const body = await r.text()
        res.json({ ok: false, error: `HTTP ${r.status}: ${body}` })
      }

    } else {
      res.status(400).json({ ok: false, error: `Unknown engine: ${engine}` })
    }
  } catch (e) {
    res.json({ ok: false, error: String(e) })
  }
})

export default router
