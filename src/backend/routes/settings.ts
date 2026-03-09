import { getCurrentDbPath } from '../db/state.js'
import { setVerboseLogging } from '../lib/ai-logging.js'

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

// ── Exports ───────────────────────────────────────────────────────────────────

export function getLayout(): unknown {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath, { readonly: true })
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'layout'")
    .get() as { value: string } | undefined
  db.close()

  let layout: unknown = null
  if (row) {
    try {
      layout = JSON.parse(row.value)
    } catch (_) {
      console.error('[Layout GET] failed to parse layout JSON')
      layout = null
    }
  }
  return layout
}

export function saveLayout(layout: unknown): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath || !layout) throw makeError('layout required, db must be open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const serialised = JSON.stringify(layout)
  const db = new Database(dbPath)
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('layout', ?)").run(serialised)
  db.close()
  return { ok: true }
}

export function setVerboseAiLogging(value: unknown): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath || value === undefined) throw makeError('value required, db must be open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const strValue = String(value)
  const db = new Database(dbPath)
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('verbose_ai_logging', ?)").run(strValue)
  db.close()
  setVerboseLogging(strValue === 'true')
  return { ok: true }
}

export function getSetting(key: string): { value: string | null } {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath, { readonly: true })
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  db.close()
  return { value: row ? row.value : null }
}

export function setSetting(key: string, value: unknown): { ok: boolean } {
  const dbPath = getCurrentDbPath()
  if (!dbPath || value === undefined) throw makeError('value required, db must be open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value))
  db.close()
  return { ok: true }
}
