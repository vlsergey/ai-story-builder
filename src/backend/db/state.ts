import fs from 'fs'
import path from 'path'
import type { AppSettings } from '../types/index.js'

export const APP_SETTINGS_PATH = path.join(process.cwd(), 'data', 'app_settings.json')

let currentDbPath: string | null = null

export function getCurrentDbPath(): string | null {
  return currentDbPath
}

export function setCurrentDbPath(p: string | null): void {
  currentDbPath = p
}

export function readAppSettings(): AppSettings {
  try {
    return JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf8')) as AppSettings
  } catch (_) {
    return { recent: [] }
  }
}

export function writeAppSettings(s: AppSettings): void {
  fs.mkdirSync(path.dirname(APP_SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(s, null, 2))
}
