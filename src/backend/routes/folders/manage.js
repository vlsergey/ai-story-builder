const express = require('express')
const Database = require('better-sqlite3')

const router = express.Router()

router.post('/', express.json(), (req, res) => {
  const { db: dbPath, parent_id, name } = req.body
  if (!dbPath || !name) return res.status(400).json({ error: 'db and name required' })
  try {
    const db = new Database(dbPath)
    const stmt = db.prepare('INSERT INTO folders (parent_id, name) VALUES (?, ?)')
    const info = stmt.run(parent_id || null, name)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.delete('/:id', (req, res) => {
  const dbPath = req.query.db
  if (!dbPath) return res.status(400).json({ error: 'db required' })
  try {
    const db = new Database(dbPath)
    const stmt = db.prepare('DELETE FROM folders WHERE id = ?')
    stmt.run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.post('/:id/move', express.json(), (req, res) => {
  const { db: dbPath, parent_id } = req.body
  const id = req.params.id
  if (!dbPath) return res.status(400).json({ error: 'db required' })
  try {
    const db = new Database(dbPath)
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parent_id || null, id)
    db.close()
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

module.exports = router
