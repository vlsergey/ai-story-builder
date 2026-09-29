import fs from "node:fs"
import Database from "better-sqlite3"
import { createBackup } from "./backup.js"
import { assertReadableVersion, CURRENT_VERSION, migrateDatabase } from "./migrations.js"

/**
 * Opens a project database, creates a backup of any existing file, runs all
 * pending migrations, and returns the open Database instance.
 * Caller must close() it when done.
 * @param dbPath - Absolute path to the .sqlite file
 */
export function openProjectDatabase(dbPath: string): Database.Database {
  // A file from a newer version is refused before it is backed up: each
  // refused attempt would otherwise add a copy and rotate out an older backup
  // — the very ones this version can still read.
  if (fs.existsSync(dbPath)) {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      assertReadableVersion(probe)
    } finally {
      probe.close()
    }
  }
  createBackup(dbPath)
  const db = new Database(dbPath)
  try {
    migrateDatabase(db)
  } catch (e) {
    db.close()
    throw e
  }
  return db
}

export { CURRENT_VERSION }
