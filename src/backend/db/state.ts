import fs from 'fs'
import path from 'path'
import type { AppSettings } from '../types/index.js'

/**
 * Returns the root data directory for user data.
 * In production (Electron): app.getPath('userData') — the OS-standard location.
 * In development (plain Node.js / tests): <cwd>/data as a local fallback.
 */
export function getDataDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app: electronApp } = require('electron') as typeof import('electron')
    return electronApp.getPath('userData')
  } catch (_) {
    return path.join(process.cwd(), 'data')
  }
}

let currentDbPath: string | null = null

export function getCurrentDbPath(): string | null {
  return currentDbPath
}

export function setCurrentDbPath(p: string | null): void {
  currentDbPath = p
}

export function readAppSettings(): AppSettings {
  const settingsPath = path.join(getDataDir(), 'app_settings.json')
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as AppSettings
  } catch (_) {
    return { recent: [] }
  }
}

export function writeAppSettings(s: AppSettings): void {
  const settingsPath = path.join(getDataDir(), 'app_settings.json')
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2))
}
