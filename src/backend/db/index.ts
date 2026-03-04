import { migrateDatabase, CURRENT_VERSION } from './migrations'
import { createBackup } from './backup'

let DatabaseConstructor: typeof import('better-sqlite3') | null = null
try { DatabaseConstructor = require('better-sqlite3') } catch (e) { DatabaseConstructor = null }

/**
 * Opens a project database, creates a backup of any existing file, runs all
 * pending migrations, and returns the open Database instance.
 * Caller must close() it when done.
 * @param dbPath - Absolute path to the .sqlite file
 */
export function openProjectDatabase(dbPath: string): import('better-sqlite3').Database {
  if (!DatabaseConstructor) throw new Error('SQLite library not available')
  createBackup(dbPath)
  const db = new DatabaseConstructor(dbPath)
  migrateDatabase(db)
  return db
}

export { CURRENT_VERSION }
