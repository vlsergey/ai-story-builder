const express = require('express')
const fs = require('fs')
const path = require('path')

const router = express.Router()

router.post('/create', express.json(), (req, res) => {
  const name = (req.body && req.body.name) ? req.body.name : `project-${Date.now()}`
  const safeName = name.replace(/[^a-zA-Z0-9-_\.]/g, '_')
  const projectsDir = path.join(process.cwd(), 'data', 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const dbPath = path.join(projectsDir, `${safeName}.sqlite`)

  if (fs.existsSync(dbPath)) {
    const s = readSettings()
    s.recent = s.recent || []
    s.recent = [dbPath].concat(s.recent.filter(x => x !== dbPath)).slice(0, 10)
    writeSettings(s)
    return res.json({ path: dbPath, reused: true })
  }

  let Database
  try { Database = require('better-sqlite3') } catch (e) { Database = null }
  if (!Database) return res.status(500).json({ error: 'SQLite library not available' })

  try {
    const db = new Database(dbPath)
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NULL REFERENCES folders(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS lore_items (
        id INTEGER PRIMARY KEY,
        folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS lore_versions (
        id INTEGER PRIMARY KEY,
        lore_item_id INTEGER NOT NULL REFERENCES lore_items(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        ai_model TEXT NULL,
        ai_import_id TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS plan_nodes (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS plan_node_versions (
        id INTEGER PRIMARY KEY,
        plan_node_id INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        summary TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS generated_parts (
        id INTEGER PRIMARY KEY,
        plan_node_version_id INTEGER NOT NULL REFERENCES plan_node_versions(id) ON DELETE CASCADE,
        title TEXT,
        content TEXT NOT NULL,
        ai_model TEXT NOT NULL,
        ai_import_id TEXT NULL,
        meta TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS generated_part_lore_versions (
        generated_part_id INTEGER NOT NULL REFERENCES generated_parts(id) ON DELETE CASCADE,
        lore_version_id INTEGER NOT NULL REFERENCES lore_versions(id) ON DELETE CASCADE,
        PRIMARY KEY (generated_part_id, lore_version_id)
      );

      CREATE TABLE IF NOT EXISTS ai_calls (
        id INTEGER PRIMARY KEY,
        model TEXT NOT NULL,
        prompt TEXT,
        response_summary TEXT,
        response TEXT NULL,
        tokens INTEGER NULL,
        ai_import_id TEXT NULL,
        related_generated_part_id INTEGER NULL REFERENCES generated_parts(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)
    // Insert root folder and some default folders
    const insertFolder = db.prepare('INSERT INTO folders (parent_id, name) VALUES (?, ?)')
    const root = insertFolder.run(null, 'Story Lore')
    const rootId = root.lastInsertRowid
    const defaults = ['locations', 'abilities', 'spells', 'bestiary', 'characters']
    const stmt = db.prepare('INSERT INTO folders (parent_id, name) VALUES (?, ?)')
    for (const f of defaults) stmt.run(rootId, f)
    db.close()
    const s = readSettings()
    s.recent = s.recent || []
    s.recent = [dbPath].concat(s.recent.filter(x => x !== dbPath)).slice(0, 10)
    writeSettings(s)
    return res.json({ path: dbPath })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})


// helpers reused by multiple project route files
function readSettings() {
  const APP_SETTINGS = path.join(process.cwd(), 'data', 'app_settings.json')
  try { return JSON.parse(fs.readFileSync(APP_SETTINGS, 'utf8')) } catch (e) { return { recent: [] } }
}
function writeSettings(s) {
  const APP_SETTINGS = path.join(process.cwd(), 'data', 'app_settings.json')
  fs.mkdirSync(path.dirname(APP_SETTINGS), { recursive: true });
  fs.writeFileSync(APP_SETTINGS, JSON.stringify(s, null, 2));
}

module.exports = router
