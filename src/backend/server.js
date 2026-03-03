const express = require('express')
const path = require('path')
const fs = require('fs')

const app = express()
// Use port 3001 for development (Vite dev server takes 3000), 3000 for production
const port = process.env.NODE_ENV === 'development' ? 3001 : (process.env.PORT || 3000)

// Determine where the built frontend lives.
// In Electron (dev or packaged), app.getAppPath() points to the project/app root.
// When invoked directly with `node server.js`, fall back to the relative path.
function getDistPath() {
  try {
    const { app: electronApp } = require('electron')
    return path.join(electronApp.getAppPath(), 'dist')
  } catch (_) {
    return path.resolve(__dirname, '..', '..', 'dist')
  }
}

// ensure upload folder exists
fs.mkdirSync(path.join(process.cwd(), 'data', 'uploads'), { recursive: true })

app.use(express.json())

// Log all 4xx/5xx responses with stack trace
app.use((req, res, next) => {
  const originalJson = res.json.bind(res)
  res.json = function (body) {
    if (res.statusCode >= 400) {
      const err = new Error(`${res.statusCode} ${req.method} ${req.url}`)
      console.error(err.message, body, err.stack)
    }
    return originalJson(body)
  }
  next()
})

// API routes
try {
  const projectRoutes = require('./projectRoutes')
  app.use('/api', projectRoutes)
} catch (e) {
  console.warn('projectRoutes not available:', e && e.stack ? e.stack : e && e.message)
}

app.get('/api/hello', (req, res) => {
  res.json({ message: 'hello from backend' })
})

// Serve the built frontend in production (in development Vite handles this)
if (process.env.NODE_ENV !== 'development') {
  const distPath = getDistPath()
  app.use(express.static(distPath))
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

/**
 * Starts the HTTP server and resolves to the server URL when ready.
 * Called by the Electron main process in production.
 * @returns {Promise<string>}
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`
      console.log(`Server listening on ${url}`)
      resolve(url)
    })
    server.on('error', reject)
  })
}

// Auto-start when invoked directly (e.g. `node server.js` or `nodemon server.js`)
if (require.main === module) {
  startServer().catch(console.error)
}

module.exports = { startServer }
