const express = require('express')
const path = require('path')

const app = express()
// Use port 3001 for development, 3000 for production
const port = process.env.NODE_ENV === 'development' ? 3001 : (process.env.PORT || 3000)
// Determine frontend dist directory relative to project root.  
// When running from backend directory (__dirname is src/backend), we need
// to go up two levels to reach the workspace root before `dist`.
const distPath = path.resolve(__dirname, '..', '..', 'dist')

// ensure upload folders exist
const fs = require('fs')
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

// static frontend (production only — in development Vite serves the frontend)
if (process.env.NODE_ENV !== 'development') {
  app.use(express.static(distPath))

  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
  // Open browser only in production — in development Vite handles this once on startup
  if (process.env.NODE_ENV !== 'development') {
    try {
      const open = require('open')
      open(`http://localhost:${port}`).catch(() => {})
    } catch (e) {
      // ignore if open not installed
    }
  }
})
