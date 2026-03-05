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

// POST /generate
router.post('/generate', express.json(), (req: Request, res: Response) => {
  const { plan_node_version_id, prompt } = req.body as {
    plan_node_version_id?: number
    prompt?: string
  }
  const dbPath = getCurrentDbPath()
  if (!dbPath || !plan_node_version_id) {
    return res
      .status(400)
      .json({ error: 'plan_node_version_id required, db must be open' })
  }
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    const generatedContent = `Generated content for plan_node_version ${plan_node_version_id}\nPrompt:\n${prompt ?? ''}`
    const g = db
      .prepare(
        'INSERT INTO story_parts (plan_node_version_id, version, content) VALUES (?, ?, ?)',
      )
      .run(plan_node_version_id, 1, generatedContent)
    const gid = g.lastInsertRowid
    db.prepare(
      'INSERT INTO ai_calls (backend, model, prompt, response_summary, related_story_part_id) VALUES (?, ?, ?, ?, ?)',
    ).run('mock', 'mock', prompt ?? '', generatedContent.slice(0, 200), gid)
    db.close()
    res.json({ story_part_id: gid })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PUT /generated_parts/:id
router.put('/generated_parts/:id', express.json(), (req: Request, res: Response) => {
  const { content } = req.body as { content?: string }
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  try {
    const db = new Database(dbPath)
    db.prepare('UPDATE story_parts SET content = ? WHERE id = ?').run(
      content ?? null,
      req.params.id,
    )
    db.close()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
