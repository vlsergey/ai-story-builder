import { getCurrentDbPath } from '../db/state.js'

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

export function generate(data: { plan_node_version_id?: number; prompt?: string }): { story_part_id: number | bigint } {
  const { plan_node_version_id, prompt } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath || !plan_node_version_id) {
    throw makeError('plan_node_version_id required, db must be open', 400)
  }
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  const generatedContent = `Generated content for plan_node_version ${plan_node_version_id}\nPrompt:\n${prompt ?? ''}`
  const g = db
    .prepare(
      'INSERT INTO story_parts (plan_node_version_id, version, content) VALUES (?, ?, ?)',
    )
    .run(plan_node_version_id, 1, generatedContent)
  const gid = g.lastInsertRowid
  db.close()
  return { story_part_id: gid }
}

export function updateGeneratedPart(id: number, data: { content?: string }): { ok: boolean } {
  const { content } = data
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath)
  db.prepare('UPDATE story_parts SET content = ? WHERE id = ?').run(
    content ?? null,
    id,
  )
  db.close()
  return { ok: true }
}
