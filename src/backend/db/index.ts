import fs from "node:fs"
import path from "node:path"
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
    let version: number
    try {
      assertReadableVersion(probe)
      version = probe.pragma("user_version", { simple: true }) as number
    } finally {
      probe.close()
    }
    if (version > 0 && version < CURRENT_VERSION) pinPreMigrationCopy(dbPath, version)
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

/**
 * Keeps a copy of the file as it was before this version first migrated it.
 * Rotating backups keep seven, so after a week of opens the last copy an
 * older build could read would be gone; this one is named outside their
 * `{basename}.*.bak` pattern and never pruned.
 */
function pinPreMigrationCopy(dbPath: string, version: number): void {
  const dir = path.join(path.dirname(dbPath), "backups")
  const pinned = path.join(dir, `${path.basename(dbPath, path.extname(dbPath))}.v${version}.sqlite`)
  if (fs.existsSync(pinned)) return
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(dbPath, pinned)
  console.log(`[db] kept the version ${version} file before migrating it: ${pinned}`)
}

export { CURRENT_VERSION }
