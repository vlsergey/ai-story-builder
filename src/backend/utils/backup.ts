import fs from "node:fs"
import path from "node:path"
import { getDataDir } from "../db/state.js"

/**
 * Creates a backup of a project database file
 * @param dbPath - Path to the database file to backup
 * @returns Path to the created backup file
 */
export function createBackup(dbPath: string): string {
  // Ensure backups directory exists
  const backupsDir = path.join(getDataDir(), "backups")
  fs.mkdirSync(backupsDir, { recursive: true })

  // Get the filename without extension for the backup name
  const filename = path.basename(dbPath)
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const backupName = `${filename}.${ts}.bak`
  const backupPath = path.join(backupsDir, backupName)

  // Create backup by copying the file
  fs.copyFileSync(dbPath, backupPath)

  // Trim backups to last 7
  trimBackups(filename, backupsDir)

  return backupPath
}

/**
 * Trims backups to keep only the last 7
 * @param filename - Base filename to match
 * @param backupsDir - Directory containing backups
 */
export function trimBackups(filename: string, backupsDir: string): void {
  try {
    const all = fs.readdirSync(backupsDir).filter((f) => f.startsWith(filename + "."))
    all.sort()
    while (all.length > 7) {
      const rm = all.shift()
      try {
        fs.unlinkSync(path.join(backupsDir, rm!))
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    // Ignore errors in trimming
  }
}

/**
 * Gets the most recent backup for a database file
 * @param dbPath - Path to the database file
 * @returns Path to the most recent backup or null if none found
 */
export function getLatestBackup(dbPath: string): string | null {
  const backupsDir = path.join(getDataDir(), "backups")
  if (!fs.existsSync(backupsDir)) return null

  const filename = path.basename(dbPath)
  try {
    const all = fs.readdirSync(backupsDir).filter((f) => f.startsWith(filename + "."))
    if (all.length === 0) return null

    all.sort()
    return path.join(backupsDir, all[all.length - 1])
  } catch (_) {
    return null
  }
}
