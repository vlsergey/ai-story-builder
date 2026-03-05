import express from 'express'
import path from 'path'
import fs from 'fs'

import projectsRouter from './routes/projects.js'
import loreRouter from './routes/lore.js'
import plansRouter from './routes/plans.js'
import generationRouter from './routes/generation.js'
import settingsRouter from './routes/settings.js'
import aiConfigRouter from './routes/ai-config.js'
import aiSyncRouter from './routes/ai-sync.js'
import generateLoreRouter from './routes/generate-lore.js'
import { getDataDir, restoreLastOpenedProject } from './db/state.js'
import { applyRuntimeSettings } from './routes/projects.js'

const app = express()
// Use port 3001 for development (Vite dev server takes 3000), 3000 for production
const port = process.env['NODE_ENV'] === 'development' ? 3001 : (Number(process.env['PORT']) || 3000)

// Determine where the built frontend lives.
// In Electron (dev or packaged), app.getAppPath() points to the project/app root.
// When invoked directly with `node server.js`, fall back to the relative path.
function getDistPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app: electronApp } = require('electron') as typeof import('electron')
    return path.join(electronApp.getAppPath(), 'dist')
  } catch (_) {
    return path.resolve(__dirname, '..', '..', 'dist')
  }
}

// Ensure upload folder exists
fs.mkdirSync(path.join(getDataDir(), 'uploads'), { recursive: true })

// Restore the last opened project so backend restarts are transparent in dev
const restoredPath = restoreLastOpenedProject()
if (restoredPath) applyRuntimeSettings(restoredPath)

app.use(express.json())

// Log all 4xx/5xx responses with body
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
app.use('/api/project', projectsRouter)
app.use('/api/lore', loreRouter)
app.use('/api/plan', plansRouter)
app.use('/api', generationRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/ai', aiConfigRouter)
app.use('/api/ai', aiSyncRouter)
app.use('/api/ai', generateLoreRouter)

app.get('/api/hello', (_req, res) => {
  res.json({ message: 'hello from backend' })
})

// Serve the built frontend in production (in development Vite handles this)
if (process.env['NODE_ENV'] !== 'development') {
  const distPath = getDistPath()
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

/**
 * Starts the HTTP server and resolves to the server URL when ready.
 * Called by the Electron main process in production.
 */
export function startServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`
      console.log(`Server listening on ${url}`)
      resolve(url)
    })
    server.on('error', reject)
  })
}

// Auto-start when invoked directly (e.g. `tsx server.ts` or `node server.js`)
if (require.main === module) {
  startServer().catch(console.error)
}
