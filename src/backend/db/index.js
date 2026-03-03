'use strict'

const { migrateDatabase, CURRENT_VERSION } = require('./migrations')

let Database
try { Database = require('better-sqlite3') } catch (e) { Database = null }

/**
 * Opens a project database, runs all pending migrations, and returns
 * the open Database instance. Caller must close() it when done.
 * A backup should be created by the caller before calling this function.
 * @param {string} dbPath - Absolute path to the .sqlite file
 * @returns {import('better-sqlite3').Database}
 */
function openProjectDatabase(dbPath) {
  if (!Database) throw new Error('SQLite library not available')
  const db = new Database(dbPath)
  migrateDatabase(db)
  return db
}

module.exports = { openProjectDatabase, CURRENT_VERSION }
