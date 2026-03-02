// NOTE: this file has grown large.  Per project coding guidelines,
// each domain/entity should have its own route module (e.g. folders.js,
// lore.js, plan.js, etc.) imported here.  Refactor when time permits.
const express = require('express')
const fs = require('fs')
const path = require('path')

const router = express.Router()

// Global state: track currently open database
let currentDbPath = null

// Helper to get current database path
function getCurrentDbPath(req) {
  // If explicitly provided in request, use it (legacy support)
  if (req.body && req.body.db) return req.body.db
  if (req.query && req.query.db) return req.query.db
  // Otherwise use the current state
  return currentDbPath
}

// Helper to set current database path
function setCurrentDbPath(dbPath) {
  currentDbPath = dbPath
}

// modular subrouters
router.use('/project', require('./routes/projects/recent'))

// Read layout and project title from an already-opened database
function getProjectInitialData(dbPath) {
  const Database = (() => { try { return require('better-sqlite3') } catch (e) { return null } })()
  if (!Database) return {}
  try {
    const db = new Database(dbPath, { readonly: true })
    const layoutRow = db.prepare("SELECT value FROM settings WHERE key = 'layout'").get()
    const titleRow = db.prepare("SELECT value FROM settings WHERE key = 'project_title'").get()
    db.close()
    let layout = null
    if (layoutRow) { try { layout = JSON.parse(layoutRow.value) } catch (e) {} }
    return { layout, projectTitle: titleRow ? titleRow.value : null }
  } catch (e) {
    console.warn('[getProjectInitialData] failed to read initial data from', dbPath, e.message)
    return {}
  }
}


// `multer` is an optional dependency used for file uploads. In case it's not
// installed (e.g., during minimal installs), we provide a graceful fallback
// middleware that returns a helpful error response when upload is attempted.
let upload
try {
  const multer = require('multer')
  upload = multer({ dest: path.join(process.cwd(), 'data', 'uploads') })
} catch (e) {
  upload = {
    single: () => (req, res, next) => {
      res.status(501).json({ error: 'file upload not available (multer missing)' })
    }
  }
}

const APP_SETTINGS = path.join(process.cwd(), 'data', 'app_settings.json')
function readSettings() {
  try { return JSON.parse(fs.readFileSync(APP_SETTINGS, 'utf8')) } catch (e) { return { recent: [] } }
}
function writeSettings(s) { fs.mkdirSync(path.dirname(APP_SETTINGS), { recursive: true }); fs.writeFileSync(APP_SETTINGS, JSON.stringify(s, null, 2)); }

// Get the status of the currently open database
router.get('/project/status', (req, res) => {
  res.json({ isOpen: !!currentDbPath, path: currentDbPath })
})

// Close the currently open project
router.post('/project/close', (req, res) => {
  setCurrentDbPath(null)
  res.json({ ok: true })
})

// Open a project by path
router.post('/project/open', express.json(), (req, res) => {
  const { path: dbPath } = req.body
  if (!dbPath) return res.status(400).json({ error: 'path required' })
  
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'database file not found' })
  }
  
  // Set current database to this path
  setCurrentDbPath(dbPath)
  
  // Verify the database is readable (basic schema check)
  const Database = (() => { try { return require('better-sqlite3') } catch (e) { return null } })()
  let versionState = 'unknown'
  if (Database) {
    try {
      const db = new Database(dbPath, { readonly: true })
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get()
      versionState = row ? 'ok' : 'old'
      db.close()
    } catch (e) {
      return res.status(500).json({ error: 'failed to open database: ' + String(e) })
    }
  }
  
  // update recent list
  const s = readSettings()
  s.recent = s.recent || []
  s.recent = [dbPath].concat(s.recent.filter(x => x !== dbPath)).slice(0, 10)
  writeSettings(s)

  res.json({ path: dbPath, versionState, ...getProjectInitialData(dbPath) })
})

// Return recent projects
router.get('/project/recent', (req, res) => {
  const s = readSettings()
  res.json(s.recent || [])
})

// Upload/open a project sqlite file
router.post('/project/upload', upload.single('dbfile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const projectsDir = path.join(process.cwd(), 'data', 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const dest = path.join(projectsDir, req.file.originalname)
  // move uploaded file
  fs.renameSync(req.file.path, dest)

  // Set current database to this path
  setCurrentDbPath(dest)

  // create backup
  const backupsDir = path.join(process.cwd(), 'data', 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupName = `${req.file.originalname}.${ts}.bak`
  fs.copyFileSync(dest, path.join(backupsDir, backupName))

  // trim backups to last 7
  const all = fs.readdirSync(backupsDir).filter(f => f.startsWith(req.file.originalname + '.'))
  all.sort()
  while (all.length > 7) {
    const rm = all.shift()
    try { fs.unlinkSync(path.join(backupsDir, rm)) } catch (e) {}
  }

  // update recent list
  const s = readSettings()
  s.recent = s.recent || []
  // move to front and dedupe
  s.recent = [dest].concat(s.recent.filter(x => x !== dest)).slice(0, 10)
  writeSettings(s)

  // basic schema/version check: check for existence of table `settings` as placeholder
  const Database = (() => { try { return require('better-sqlite3') } catch (e) { return null } })()
  let versionState = 'unknown'
  if (Database) {
    try {
      const db = new Database(dest, { readonly: true })
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get()
      versionState = row ? 'ok' : 'old'
      db.close()
    } catch (e) {
      versionState = 'error'
    }
  }

  res.json({ path: dest, backup: backupName, versionState, ...getProjectInitialData(dest) })
})

// Create a new project (initialize sqlite DB with base schema and default folders)
router.post('/project/create', express.json(), (req, res) => {
  const name = (req.body && req.body.name) ? req.body.name : `project-${Date.now()}`
  const safeName = name.replace(/[^a-zA-Z0-9-_\.]/g, '_')
  const projectsDir = path.join(process.cwd(), 'data', 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const dbPath = path.join(projectsDir, `${safeName}.sqlite`)

  // If database already exists, just return it instead of recreating
  if (fs.existsSync(dbPath)) {
    // Set current database to this path
    setCurrentDbPath(dbPath)
    // update recent list as in upload
    const s = readSettings()
    s.recent = s.recent || []
    s.recent = [dbPath].concat(s.recent.filter(x => x !== dbPath)).slice(0, 10)
    writeSettings(s)
    return res.json({ path: dbPath, reused: true })
  }

  // Initialize SQLite DB schema using better-sqlite3 if available
  let Database
  try { Database = require('better-sqlite3') } catch (e) { Database = null }
  if (!Database) return res.status(500).json({ error: 'SQLite library not available' })

  try {
    const db = new Database(dbPath)
    db.pragma('foreign_keys = ON')

    // Create base tables (matching docs/data_model.md)
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

    // store basic settings
    const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    setSetting.run('project_title', name)
    setSetting.run('locale', 'en')
    setSetting.run('schema_version', '1')

    db.close()

    // Set current database to this path
    setCurrentDbPath(dbPath)

    // update recent list
    const s = readSettings()
    s.recent = s.recent || []
    s.recent = [dbPath].concat(s.recent.filter(x => x !== dbPath)).slice(0, 10)
    writeSettings(s)

    return res.json({ path: dbPath, layout: null, projectTitle: name })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})

// -- Folders API --
router.get('/folders/tree', (req, res) => {
  const Database = (() => { try { return require('better-sqlite3') } catch (e) { return null } })()
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.json([])
  try {
    const db = new Database(dbPath, { readonly: true })
    db.pragma('foreign_keys = ON')
    const folders = db.prepare('SELECT id, parent_id, name, created_at FROM folders ORDER BY id').all()
    db.close()
    // build tree
    const map = new Map(); folders.forEach(f => map.set(f.id, { ...f, children: [] }))
    const roots = []
    for (const f of map.values()) {
      if (f.parent_id && map.has(f.parent_id)) map.get(f.parent_id).children.push(f)
      else roots.push(f)
    }
    res.json(roots)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.post('/folders', express.json(), (req, res) => {
  const { parent_id, name } = req.body
  const dbPath = getCurrentDbPath(req)
  if (!dbPath || !name) return res.status(400).json({ error: 'name required and db must be open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const stmt = db.prepare('INSERT INTO folders (parent_id, name) VALUES (?, ?)')
    const info = stmt.run(parent_id || null, name)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.delete('/folders/:id', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json({ error: 'db not open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const stmt = db.prepare('DELETE FROM folders WHERE id = ?')
    stmt.run(req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// Move folder to new parent and optionally set position
router.post('/folders/:id/move', express.json(), (req, res) => {
  const { parent_id } = req.body
  const id = req.params.id
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json({ error: 'db not open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parent_id || null, id)
    db.close()
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// -- Lore items and versions --
router.post('/lore_items', express.json(), (req, res) => {
  const { folder_id, slug, title } = req.body
  const dbPath = getCurrentDbPath(req)
  if (!dbPath || !folder_id || !slug) return res.status(400).json({ error: 'folder_id and slug required, db must be open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const stmt = db.prepare('INSERT INTO lore_items (folder_id, slug, title) VALUES (?, ?, ?)')
    const info = stmt.run(folder_id, slug, title || null)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.get('/folders/:id/lore_items', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json([])
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare('SELECT id, folder_id, slug, title, created_at FROM lore_items WHERE folder_id = ?').all(req.params.id)
    db.close()
    res.json(rows)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.get('/lore_items/:id/versions', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json([])
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare('SELECT id, version, content, ai_model, ai_import_id, created_at FROM lore_versions WHERE lore_item_id = ? ORDER BY version DESC').all(req.params.id)
    db.close()
    res.json(rows)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.post('/lore_items/:id/versions', express.json(), (req, res) => {
  const { content, ai_model, ai_import_id } = req.body
  const lid = req.params.id
  const dbPath = getCurrentDbPath(req)
  if (!dbPath || !content) return res.status(400).json({ error: 'content required, db must be open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const cur = db.prepare('SELECT COALESCE(MAX(version), 0) as v FROM lore_versions WHERE lore_item_id = ?').get(lid)
    const next = (cur && cur.v) ? cur.v + 1 : 1
    const stmt = db.prepare('INSERT INTO lore_versions (lore_item_id, version, content, ai_model, ai_import_id) VALUES (?, ?, ?, ?, ?)')
    const info = stmt.run(lid, next, content, ai_model || null, ai_import_id || null)
    db.close()
    res.json({ id: info.lastInsertRowid, version: next })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.get('/lore_items/:id/latest', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json({ error: 'db not open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare('SELECT * FROM lore_versions WHERE lore_item_id = ? ORDER BY version DESC LIMIT 1').get(req.params.id)
    db.close()
    res.json(row || null)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// Import a file into a folder as a new lore item and initial version
// Expects multipart form-data with `file`, and field `folder_id`.
router.post('/lore_items/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' })
  const dbPath = getCurrentDbPath(req)
  const folder_id = req.body.folder_id
  if (!dbPath || !folder_id) return res.status(400).json({ error: 'db not open, folder_id required' })
  try {
    const content = fs.readFileSync(req.file.path, 'utf8')
    const slug = path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[^a-z0-9-_]/ig, '_')
    const title = req.file.originalname
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const info = db.prepare('INSERT INTO lore_items (folder_id, slug, title) VALUES (?, ?, ?)').run(folder_id, slug, title)
    const lid = info.lastInsertRowid
    db.prepare('INSERT INTO lore_versions (lore_item_id, version, content) VALUES (?, ?, ?)').run(lid, 1, content)
    db.close()
    // cleanup uploaded file
    try { fs.unlinkSync(req.file.path) } catch (e) {}
    res.json({ id: lid })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// -- Plan nodes and versions --
router.get('/plan/nodes', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json([])
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const nodes = db.prepare('SELECT id, parent_id, title, position, created_at FROM plan_nodes ORDER BY position, id').all()
    db.close()
    // build tree
    const map = new Map(); nodes.forEach(n => map.set(n.id, { ...n, children: [] }))
    const roots = []
    for (const n of map.values()) {
      if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id).children.push(n)
      else roots.push(n)
    }
    res.json(roots)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.post('/plan/nodes', express.json(), (req, res) => {
  const { parent_id, title, position } = req.body
  const dbPath = getCurrentDbPath(req)
  if (!dbPath || !title) return res.status(400).json({ error: 'title required, db must be open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const info = db.prepare('INSERT INTO plan_nodes (parent_id, title, position) VALUES (?, ?, ?)').run(parent_id || null, title, position || 0)
    db.close()
    res.json({ id: info.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// Plan node versions: list and create
router.get('/plan/nodes/:id/versions', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json([])
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare('SELECT id, plan_node_id, version, summary, notes, created_at FROM plan_node_versions WHERE plan_node_id = ? ORDER BY version DESC').all(req.params.id)
    db.close()
    res.json(rows)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// Restore endpoints: copy an old version into a new current version
router.post('/restore/lore_version/:id', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json({ error: 'db not open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const old = db.prepare('SELECT lore_item_id, content FROM lore_versions WHERE id = ?').get(req.params.id)
    if (!old) return res.status(404).json({ error: 'version not found' })
    const cur = db.prepare('SELECT COALESCE(MAX(version),0) as v FROM lore_versions WHERE lore_item_id = ?').get(old.lore_item_id)
    const next = (cur && cur.v) ? cur.v + 1 : 1
    db.prepare('INSERT INTO lore_versions (lore_item_id, version, content) VALUES (?, ?, ?)').run(old.lore_item_id, next, old.content)
    db.close()
    res.json({ restoredVersion: next })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.post('/restore/plan_node_version/:id', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json({ error: 'db not open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const old = db.prepare('SELECT plan_node_id, summary, notes FROM plan_node_versions WHERE id = ?').get(req.params.id)
    if (!old) return res.status(404).json({ error: 'version not found' })
    const cur = db.prepare('SELECT COALESCE(MAX(version),0) as v FROM plan_node_versions WHERE plan_node_id = ?').get(old.plan_node_id)
    const next = (cur && cur.v) ? cur.v + 1 : 1
    db.prepare('INSERT INTO plan_node_versions (plan_node_id, version, summary, notes) VALUES (?, ?, ?, ?)').run(old.plan_node_id, next, old.summary, old.notes)
    db.close()
    res.json({ restoredVersion: next })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.post('/plan/nodes/:id/versions', express.json(), (req, res) => {
  const { summary, notes } = req.body
  const pid = req.params.id
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json({ error: 'db not open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const cur = db.prepare('SELECT COALESCE(MAX(version), 0) as v FROM plan_node_versions WHERE plan_node_id = ?').get(pid)
    const next = (cur && cur.v) ? cur.v + 1 : 1
    const info = db.prepare('INSERT INTO plan_node_versions (plan_node_id, version, summary, notes) VALUES (?, ?, ?, ?)').run(pid, next, summary || null, notes || null)
    db.close()
    res.json({ id: info.lastInsertRowid, version: next })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.post('/generate', express.json(), (req, res) => {
  // Mock AI generation: create generated_parts and ai_calls
  const { plan_node_version_id, prompt } = req.body
  const dbPath = getCurrentDbPath(req)
  if (!dbPath || !plan_node_version_id) return res.status(400).json({ error: 'plan_node_version_id required, db must be open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const generatedContent = `Generated content for plan_node_version ${plan_node_version_id}\nPrompt:\n${prompt || ''}`
    const g = db.prepare('INSERT INTO generated_parts (plan_node_version_id, title, content, ai_model, meta) VALUES (?, ?, ?, ?, ?)')
      .run(plan_node_version_id, 'Auto-generated', generatedContent, 'mock', JSON.stringify({ prompt }))
    const gid = g.lastInsertRowid
    db.prepare('INSERT INTO ai_calls (model, prompt, response_summary, response, related_generated_part_id) VALUES (?, ?, ?, ?, ?)')
      .run('mock', prompt || '', generatedContent.slice(0, 200), generatedContent, gid)
    db.close()
    res.json({ generated_part_id: gid })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// Generated parts APIs
router.get('/plan_node_version/:id/generated_parts', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json([])
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare('SELECT id, title, content, ai_model, meta, created_at FROM generated_parts WHERE plan_node_version_id = ?').all(req.params.id)
    db.close()
    res.json(rows)
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

router.put('/generated_parts/:id', express.json(), (req, res) => {
  const { content, title } = req.body
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json({ error: 'db not open' })
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const stmt = db.prepare('UPDATE generated_parts SET content = ?, title = ? WHERE id = ?')
    stmt.run(content || null, title || null, req.params.id)
    db.close()
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: String(e) }) }
})

// Save layout settings to database
router.post('/settings/layout', express.json(), (req, res) => {
  const { layout } = req.body
  const dbPath = getCurrentDbPath(req)
  if (!dbPath || !layout) return res.status(400).json({ error: 'layout required, db must be open' })
  try {
    console.log(`[Layout POST] saving to ${dbPath}`, {
      panelsCount: layout.panels ? Object.keys(layout.panels).length : 0,
      size: JSON.stringify(layout).length
    })
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    const result = stmt.run('layout', JSON.stringify(layout))
    db.close()
    console.log(`[Layout POST] saved successfully, changes: ${result.changes}`)
    res.json({ ok: true })
  } catch (e) { 
    console.error(`[Layout POST] error:`, e.message)
    res.status(500).json({ error: String(e) }) 
  }
})

// Get layout settings from database
router.get('/settings/layout', (req, res) => {
  const dbPath = getCurrentDbPath(req)
  if (!dbPath) return res.status(400).json({ error: 'db not open' })
  try {
    // make sure the browser does not cache responses here; we want every
    // call to hit the database so clients always see the latest layout.
    res.set('Cache-Control', 'no-store')
    res.removeHeader('ETag')

    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare("SELECT value FROM settings WHERE key = 'layout'").get()
    db.close()
    
    let layout = null
    if (row) {
      try {
        layout = JSON.parse(row.value)
      } catch (e) {
        console.error(`[Layout GET] failed to parse layout JSON:`, e.message)
        layout = null
      }
    }
    console.log(`[Layout GET] from ${dbPath}`, {
      found: !!row,
      panelsCount: layout?.panels ? Object.keys(layout.panels).length : 0,
      size: layout ? JSON.stringify(layout).length : 0
    })
    res.json(layout)
  } catch (e) { 
    console.error(`[Layout GET] error:`, e.message)
    res.status(500).json({ error: String(e) }) 
  }
})

module.exports = router


