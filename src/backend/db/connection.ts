import { getCurrentDbPath } from './state.js'
import Database from 'better-sqlite3'

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

/**
 * Executes a block with a database connection.
 * @param readonly - whether to open the database in readonly mode (default false)
 * @param block - callback that receives the Database instance and returns a result
 * @returns the result of the block
 */
export function withDb<T>(
  readonly: boolean,
  block: (db: import('better-sqlite3').Database) => T
): T {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)
  const db = new Database(dbPath, { readonly })
  try {
    return block(db)
  } finally {
    db.close()
  }
}

/**
 * Shorthand for withDb(false, block) (read/write)
 */
export function withDbWrite<T>(block: (db: import('better-sqlite3').Database) => T): T {
  return withDb(false, block)
}

/**
 * Shorthand for withDb(true, block) (readonly)
 */
export function withDbRead<T>(block: (db: import('better-sqlite3').Database) => T): T {
  return withDb(true, block)
}