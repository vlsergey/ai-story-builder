const express = require('express')
const fs = require('fs')
const path = require('path')

const router = express.Router()
const APP_SETTINGS = path.join(process.cwd(), 'data', 'app_settings.json')
function readSettings() { try { return JSON.parse(fs.readFileSync(APP_SETTINGS, 'utf8')) } catch (e) { return { recent: [] } } }

// Return recent projects
router.get('/recent', (req, res) => {
  const s = readSettings()
  res.json(s.recent || [])
})

module.exports = router
