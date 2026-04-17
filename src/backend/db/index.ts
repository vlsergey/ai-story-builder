import Database from "better-sqlite3"
import { createBackup } from "./backup.js"
import { CURRENT_VERSION, migrateDatabase } from "./migrations.js"

/**
 * Opens a project database, creates a backup of any existing file, runs all
 * pending migrations, and returns the open Database instance.
 * Caller must close() it when done.
 * @param dbPath - Absolute path to the .sqlite file
 */
export function openProjectDatabase(dbPath: string): Database.Database {
  createBackup(dbPath)
  const db = new Database(dbPath)
  migrateDatabase(db)
  return db
}

export { CURRENT_VERSION }
