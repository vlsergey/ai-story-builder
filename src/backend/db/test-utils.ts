import os from "os"
import path from "path"
import Database from "better-sqlite3"
import { migrateDatabase } from "./migrations.js"

/**
 * Creates a temporary SQLite database file with the full schema (via migrateDatabase).
 * Returns the file path. The caller is responsible for deleting the file after use.
 */
export function createTestDatabase(): string {
  const file = path.join(os.tmpdir(), `test_db_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`)
  const db = new Database(file)
  try {
    migrateDatabase(db)
  } finally {
    db.close()
  }
  return file
}

/**
 * Creates a temporary SQLite database in memory with the full schema.
 * Returns the Database instance. The caller must close it.
 */
export function createTestDatabaseInMemory(): Database.Database {
  const db = new Database(":memory:")
  migrateDatabase(db)
  return db
}
