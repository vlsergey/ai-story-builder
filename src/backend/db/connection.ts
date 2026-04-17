import type { Database } from "better-sqlite3"
import { getCurrentDb } from "./state.js"

/**
 * Executes a block with a database connection.
 * @param readonly - whether to open the database in readonly mode (default false)
 * @param block - callback that receives the Database instance and returns a result
 * @returns the result of the block
 */
export function withDb<T>(readonly: boolean, block: (db: Database) => T): T {
  return block(getCurrentDb())
}

/**
 * Shorthand for withDb(false, block) (read/write)
 */
export function withDbWrite<T>(block: (db: Database) => T): T {
  return withDb(false, block)
}

/**
 * Shorthand for withDb(true, block) (readonly)
 */
export function withDbRead<T>(block: (db: Database) => T): T {
  return withDb(true, block)
}
