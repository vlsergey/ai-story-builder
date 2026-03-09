import { getCurrentDbPath } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GrokConfig {
  api_key?: string
  available_models?: string[]
  last_model?: string
  [key: string]: unknown
}

interface YandexConfig {
  api_key?: string
  folder_id?: string
  available_models?: string[]
  last_model?: string
  [key: string]: unknown
}

interface AiConfigStore {
  grok?: GrokConfig
  yandex?: YandexConfig
  custom?: Record<string, Record<string, string>>
}

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
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

// ─── Exports ──────────────────────────────────────────────────────────────────

export function getAiConfig(): { current_engine: string | null; grok: object; yandex: object } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = getDb(dbPath, true)
  const engineRow = db
    .prepare("SELECT value FROM settings WHERE key = 'current_backend'")
    .get() as { value: string } | undefined
  db.close()

  const config = readAiConfig(dbPath)
  return {
    current_engine: engineRow?.value ?? null,
    grok: {
      api_key: '',
      available_models: [],
      last_model: null,
      ...(config.grok ?? {}),
    },
    yandex: {
      api_key: '',
      folder_id: '',
      available_models: [],
      last_model: null,
      ...(config.yandex ?? {}),
    },
  }
}

export function saveAiConfig(data: { engine: string; fields: Record<string, unknown> }): { ok: boolean } {
  const { engine, fields } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  if (!engine || !fields || typeof fields !== 'object') {
    throw makeError('engine and fields are required', 400)
  }
  const config = readAiConfig(dbPath)
  if (engine === 'grok') {
    config.grok = { ...config.grok, ...fields } as GrokConfig
  } else if (engine === 'yandex') {
    config.yandex = { ...config.yandex, ...fields } as YandexConfig
  } else {
    if (!config.custom) config.custom = {}
    config.custom[engine] = { ...(config.custom[engine] ?? {}), ...fields } as Record<string, string>
  }
  writeAiConfig(dbPath, config)
  return { ok: true }
}

export function setCurrentEngine(data: { engine: string | null }): { ok: boolean } {
  const { engine } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)

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
      throw makeError(`Missing required fields for ${engine}: ${missing.join(', ')}`, 400)
    }
  }

  const db = getDb(dbPath)
  if (engine == null) {
    db.prepare("DELETE FROM settings WHERE key = 'current_backend'").run()
  } else {
    db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('current_backend', ?)")
      .run(engine)
  }
  db.close()
  return { ok: true }
}

export function getEngineModels(engine: string): { models: string[] } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const config = readAiConfig(dbPath)
  let models: string[] = []
  if (engine === 'yandex') models = config.yandex?.available_models ?? []
  else if (engine === 'grok') models = config.grok?.available_models ?? []
  return { models }
}

export async function refreshEngineModels(engine: string): Promise<{ models: string[] }> {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)

  const config = readAiConfig(dbPath)
  let models: string[] = []

  if (engine === 'yandex') {
    const apiKey = config.yandex?.api_key?.trim()
    const folderId = config.yandex?.folder_id?.trim()
    if (!apiKey || !folderId) {
      throw makeError('Yandex api_key and folder_id are required', 400)
    }
    const r = await fetch('https://ai.api.cloud.yandex.net/v1/models', {
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'x-folder-id': folderId,
      },
    })
    if (!r.ok) {
      const body = await r.text()
      throw makeError(`Yandex API error ${r.status}: ${body}`, 502)
    }
    const data = await r.json() as { data?: { id: string }[] }
    models = (data.data ?? []).map(m => m.id).filter(id => id.startsWith('gpt://'))
    config.yandex = { ...config.yandex, available_models: models }

  } else if (engine === 'grok') {
    const apiKey = config.grok?.api_key?.trim()
    if (!apiKey) throw makeError('Grok api_key is required', 400)
    const r = await fetch('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!r.ok) {
      const body = await r.text()
      throw makeError(`Grok API error ${r.status}: ${body}`, 502)
    }
    const data = await r.json() as { data?: { id: string }[] }
    models = (data.data ?? []).map(m => m.id)
    config.grok = { ...config.grok, available_models: models }

  } else {
    throw makeError(`Model refresh not supported for engine '${engine}'`, 400)
  }

  writeAiConfig(dbPath, config)
  return { models }
}

export async function testEngineConnection(
  engine: string,
  creds: Record<string, string>
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    if (engine === 'grok') {
      const apiKey = creds['api_key']?.trim()
      if (!apiKey) throw makeError('api_key is required', 400)

      const r = await fetch('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (r.ok) {
        const data = await r.json() as { data?: unknown[] }
        const count = Array.isArray(data.data) ? data.data.length : 0
        return { ok: true, detail: `Connected. ${count} model(s) available.` }
      } else {
        const body = await r.text()
        return { ok: false, error: `HTTP ${r.status}: ${body}` }
      }

    } else if (engine === 'yandex') {
      const apiKey = creds['api_key']?.trim()
      const folderId = creds['folder_id']?.trim()
      if (!apiKey) throw makeError('api_key is required', 400)
      if (!folderId) throw makeError('folder_id is required', 400)

      const r = await fetch('https://ai.api.cloud.yandex.net/v1/models', {
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          'x-folder-id': folderId,
        },
      })
      if (r.ok) {
        const data = await r.json() as { data?: unknown[] }
        const count = Array.isArray(data.data) ? data.data.length : 0
        return { ok: true, detail: `Connected. ${count} model(s) available.` }
      } else {
        const body = await r.text()
        return { ok: false, error: `HTTP ${r.status}: ${body}` }
      }

    } else {
      return { ok: false, error: `Unknown engine: ${engine}` }
    }
  } catch (e: any) {
    if (e.status) throw e  // re-throw our own errors
    return { ok: false, error: String(e) }
  }
}
