const express = require('express')
const fs = require('fs')
const path = require('path')

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
function writeSettings(s) { const APP_SETTINGS = path.join(process.cwd(), 'data', 'app_settings.json'); fs.mkdirSync(path.dirname(APP_SETTINGS), { recursive: true }); fs.writeFileSync(APP_SETTINGS, JSON.stringify(s, null, 2)); }

router.post('/upload', upload.single('dbfile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const projectsDir = path.join(process.cwd(), 'data', 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const dest = path.join(projectsDir, req.file.originalname)
  fs.renameSync(req.file.path, dest)

  const backupsDir = path.join(process.cwd(), 'data', 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupName = `${req.file.originalname}.${ts}.bak`
  fs.copyFileSync(dest, path.join(backupsDir, backupName))

  const all = fs.readdirSync(backupsDir).filter(f => f.startsWith(req.file.originalname + '.'))
  all.sort()
  while (all.length > 7) {
    const rm = all.shift()
    try { fs.unlinkSync(path.join(backupsDir, rm)) } catch (e) {}
  }

  const s = readSettings()
  s.recent = s.recent || []
  s.recent = [dest].concat(s.recent.filter(x => x !== dest)).slice(0, 10)
  writeSettings(s)

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

  res.json({ path: dest, backup: backupName, versionState })
})

module.exports = router
