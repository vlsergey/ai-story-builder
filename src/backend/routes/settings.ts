import express, { Request, Response, Router } from 'express'
import { getCurrentDbPath } from '../db/state.js'
import { setVerboseLogging } from '../lib/yandex-client.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

// GET /settings/layout  — must be declared BEFORE /:key to avoid Express treating
// 'layout' as the key parameter value.
router.get('/layout', (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    res.set('Cache-Control', 'no-store')
    res.removeHeader('ETag')

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
    res.json(layout)
  } catch (e) {
    console.error('[Layout GET] error:', (e as Error).message)
    res.status(500).json({ error: String(e) })
  }
})

// POST /settings/layout  — must be declared BEFORE /:key for the same reason.
router.post('/layout', express.json(), (req: Request, res: Response) => {
  const { layout } = req.body as { layout?: unknown }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !layout) {
    return res.status(400).json({ error: 'layout required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const serialised = JSON.stringify(layout)
    const db = new Database(dbPath)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('layout', ?)").run(serialised)
    db.close()
    res.json({ ok: true })
  } catch (e) {
    console.error('[Layout POST] error:', (e as Error).message)
    res.status(500).json({ error: String(e) })
  }
})

// POST /settings/verbose_ai_logging — save to DB and apply to the running process immediately.
// Must be declared before /:key to avoid Express treating the literal string as the key param.
router.post('/verbose_ai_logging', express.json(), (req: Request, res: Response) => {
  const { value } = req.body as { value?: unknown }
  const dbPath = getCurrentDbPath()
  if (!dbPath || value === undefined) {
    return res.status(400).json({ error: 'value required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const strValue = String(value)
    const db = new Database(dbPath)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('verbose_ai_logging', ?)").run(strValue)
    db.close()
    setVerboseLogging(strValue === 'true')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// GET /settings/:key
router.get('/:key', (req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(req.params.key) as { value: string } | undefined
    db.close()
    res.json({ value: row ? row.value : null })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// POST /settings/:key
router.post('/:key', express.json(), (req: Request, res: Response) => {
  const { value } = req.body as { value?: unknown }
  const dbPath = getCurrentDbPath()
  if (!dbPath || value === undefined) {
    return res.status(400).json({ error: 'value required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      req.params.key,
      String(value),
    )
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
