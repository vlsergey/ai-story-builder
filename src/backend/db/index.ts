import { migrateDatabase, CURRENT_VERSION } from './migrations'

let DatabaseConstructor: typeof import('better-sqlite3') | null = null
try { DatabaseConstructor = require('better-sqlite3') } catch (e) { DatabaseConstructor = null }

/**
 * Opens a project database, runs all pending migrations, and returns
 * the open Database instance. Caller must close() it when done.
 * A backup should be created by the caller before calling this function.
 * @param dbPath - Absolute path to the .sqlite file
 */
export function openProjectDatabase(dbPath: string): import('better-sqlite3').Database {
  if (!DatabaseConstructor) throw new Error('SQLite library not available')
  const db = new DatabaseConstructor(dbPath)
  migrateDatabase(db)
  return db
}

export { CURRENT_VERSION }
