import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import type { AppSettings } from "../types/index.js"
import electron from "electron"
import Db, { type Database } from "better-sqlite3"
const { app } = electron

/**
 * Returns the root data directory for user data.
 * In production (Electron): app.getPath('userData') — the OS-standard location.
 * In development (plain Node.js / tests): use OS-specific user data directory.
 */
export function getDataDir(): string {
  try {
    return app.getPath("userData")
  } catch (_) {
    // Fallback for development mode: mimic Electron's userData path
    const home = os.homedir()
    let appData: string
    switch (process.platform) {
      case "win32":
        appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
        break
      case "darwin":
        appData = path.join(home, "Library", "Application Support")
        break
      default: // Linux and other
        appData = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
    }
    return path.join(appData, "ai-story-builder")
  }
}

let currentDb: Database | null = null
let currentDbOpen: boolean = false
let currentDbPath: string | null = null

export function isOpen() {
  return currentDbPath != null && currentDb != null && currentDbOpen
}

export function getCurrentDbPath(): string | null {
  return currentDbPath
}

export function getCurrentDb(): Database {
  if (currentDb === null) {
    throw new Error("No current database")
  }
  if (!currentDbOpen) {
    throw new Error("Current database is not opened yet")
  }
  return currentDb
}

export function setCurrentDbPath(p: string | null): void {
  if (p !== currentDbPath) {
    if (currentDb != null) {
      currentDbOpen = false
      currentDb.close()
      currentDb = null
    }
  }
  currentDbPath = p
  if (currentDbPath !== null) {
    currentDbOpen = false
    currentDb = new Db(currentDbPath)
    currentDbOpen = true
  }

  const s = readAppSettings()
  if (p) {
    s.lastOpenedPath = p
  } else {
    delete s.lastOpenedPath
  }
  writeAppSettings(s)
}

/**
 * Reads lastOpenedPath from app_settings.json and restores it as currentDbPath
 * if the file still exists on disk. Returns the restored path, or null.
 * Called once on server startup so that backend restarts are transparent.
 */
export function restoreLastOpenedProject(): string | null {
  const last = readAppSettings().lastOpenedPath
  if (!last) return null
  try {
    fs.accessSync(last)
    currentDbPath = last
    console.log(`[state] restored last opened project: ${last}`)
    return last
  } catch {
    console.log(`[state] last opened project no longer accessible, skipping: ${last}`)
    return null
  }
}

export function readAppSettings(): AppSettings {
  const settingsPath = path.join(getDataDir(), "app_settings.json")
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as AppSettings
  } catch (_) {
    return { recent: [] }
  }
}

export function writeAppSettings(s: AppSettings): void {
  const settingsPath = path.join(getDataDir(), "app_settings.json")
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2))
}
