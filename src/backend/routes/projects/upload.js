const express = require('express')
const fs = require('fs')
const path = require('path')
const { createBackup } = require('../../utils/backup')
const { openProjectDatabase, CURRENT_VERSION } = require('../../db')

const router = express.Router()
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

function readSettings() {
  const APP_SETTINGS = path.join(process.cwd(), 'data', 'app_settings.json')
  try { return JSON.parse(fs.readFileSync(APP_SETTINGS, 'utf8')) } catch (e) { return { recent: [] } }
}
function writeSettings(s) {
  const APP_SETTINGS = path.join(process.cwd(), 'data', 'app_settings.json')
  fs.mkdirSync(path.dirname(APP_SETTINGS), { recursive: true })
  fs.writeFileSync(APP_SETTINGS, JSON.stringify(s, null, 2))
}

router.post('/upload', upload.single('dbfile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const projectsDir = path.join(process.cwd(), 'data', 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const dest = path.join(projectsDir, req.file.originalname)
  fs.renameSync(req.file.path, dest)

  // Backup before any migrations
  const backupPath = createBackup(dest)
  const backupName = path.basename(backupPath)

  try {
    const db = openProjectDatabase(dest)
    const schemaVersion = db.pragma('user_version', { simple: true })
    db.close()

    const s = readSettings()
    s.recent = s.recent || []
    s.recent = [dest].concat(s.recent.filter(x => x !== dest)).slice(0, 10)
    writeSettings(s)

    res.json({ path: dest, backup: backupName, schemaVersion })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

module.exports = router
