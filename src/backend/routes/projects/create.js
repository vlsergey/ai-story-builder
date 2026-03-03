const express = require('express')
const fs = require('fs')
const path = require('path')
const { openProjectDatabase } = require('../../db')

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

  try {
    const db = openProjectDatabase(dbPath)

    // Seed default lore folder structure for new projects
    const insertFolder = db.prepare('INSERT INTO lore_folders (parent_id, name) VALUES (?, ?)')
    const root = insertFolder.run(null, 'Story Lore')
    const rootId = root.lastInsertRowid
    for (const f of ['locations', 'abilities', 'spells', 'bestiary', 'characters']) {
      insertFolder.run(rootId, f)
    }

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
