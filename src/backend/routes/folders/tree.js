const express = require('express')
const path = require('path')

const router = express.Router()

// list folder tree
router.get('/tree', (req, res) => {
  const Database = (() => { try { return require('better-sqlite3') } catch (e) { return null } })()
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  const projectsDir = path.join(process.cwd(), 'data', 'projects')
  const dbPath = req.query.db || (JSON.parse(require('fs').readFileSync(path.join(process.cwd(),'data','app_settings.json'),'utf8')).recent || [])[0]
  if (!dbPath) return res.json([])
  try {
    const db = new Database(dbPath, { readonly: true })
    db.pragma('foreign_keys = ON')
    const folders = db.prepare('SELECT id, parent_id, name, created_at FROM folders ORDER BY id').all()
    db.close()
    const map = new Map(); folders.forEach(f => map.set(f.id, { ...f, children: [] }))
    const roots = []
    for (const f of map.values()) {
      if (f.parent_id && map.has(f.parent_id)) map.get(f.parent_id).children.push(f)
      else roots.push(f)
    }
    res.json(roots)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

module.exports = router
