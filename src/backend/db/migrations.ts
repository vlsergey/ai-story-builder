import type { Database } from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

import migration001 from './migrations/001.js'
import migration002 from './migrations/002.js'
import migration003 from './migrations/003.js'
import migration004 from './migrations/004.js'
import migration005 from './migrations/005.js'
import migration006 from './migrations/006.js'
import migration007 from './migrations/007.js'
import migration008 from './migrations/008.js'
import migration009 from './migrations/009.js'
import migration010 from './migrations/010.js'
import migration011 from './migrations/011.js'
import migration012 from './migrations/012.js'
import migration013 from './migrations/013.js'
import migration014 from './migrations/014.js'
import migration015 from './migrations/015.js'
import migration016 from './migrations/016.js'
import migration017 from './migrations/017.js'
import migration018 from './migrations/018.js'
import migration019 from './migrations/019.js'
import migration020 from './migrations/020.js'
import migration021 from './migrations/021.js'
import migration022 from './migrations/022.js'
import migration023 from './migrations/023.js'
import migration024 from './migrations/024.js'
import migration025 from './migrations/025.js'

// Each entry migrates the DB from version N to N+1.
// Index 0: 0 → 1, index 1: 1 → 2, etc.
const MIGRATIONS: Array<(db: Database) => void> = [
  // version 0 → 1: initial schema
  migration001,
  // version 1 → 2: add word/char/byte counts and AI sync info to lore_nodes
  migration002,
  // version 2 → 3: backfill word/char/byte counts for existing lore_nodes with content
  migration003,
  // version 3 → 4: add text_language setting (default ru-RU) for existing projects
  migration004,
  // version 4 → 5: reset Grok sync state
  migration005,
  // version 5 → 6: add source, prompt, response_id to lore_versions
  migration006,
  // version 6 → 7: add review workflow columns to lore_nodes
  migration007,
  // version 7 → 8: remove lore_versions and plan_node_versions tables; add last_improve_instruction to lore_nodes
  migration008,
  // version 8 → 9: add stats + review workflow columns to plan_nodes; backfill counts
  migration009,
  // version 9 → 10: add last_generate_prompt to lore_nodes and plan_nodes
  migration010,
  // version 10 → 11: drop ai_calls table (was never populated, logging not used)
  migration011,
  // version 11 → 12: add graph columns to plan_nodes + plan_edges table
  migration012,
  // version 12 → 13: copy last_generate_prompt to user_prompt for plan nodes, add user_prompt and system_prompt to lore_nodes
  migration013,
  // version 13 → 14: drop last_generate_prompt column from both tables
  migration014,
  // version 14 → 15: move merge node settings from global settings to plan_nodes.merge_settings
  migration015,
  // version 15 → 16: unify edge types to 'text'
  migration016,
  // version 16 → 17: rename merge_settings to node_type_settings
  migration017,
  // version 17 → 18: add status column to plan_nodes
  migration018,
  // version 18 → 19: add ai_settings column to plan_nodes and lore_nodes
  migration019,
  // version 19 → 20: remove system_prompt, rename user_prompt to ai_instructions
  migration020,
  // version 20 → 21: remove system_prompt, rename user_prompt to ai_instructions for lore_nodes
  migration021,
  // version 21 → 22: remove auto_summary
  migration022,
  // version 22 → 23: rename name to title in lore_nodes
  migration023,
  // version 23 → 24: rename ai_instructions to ai_user_prompt and add ai_system_prompt
  migration024,
  // version 24 → 25: add width and height columns to plan_nodes and lore_nodes
  migration025,
]

export const CURRENT_VERSION = 25

function loadSchemaFromFile(db: Database): void {
  const schemaPath = path.join(__dirname, 'schema.sql')
  const sql = fs.readFileSync(schemaPath, 'utf-8')
  db.exec(sql)
}

/**
 * Runs all pending migrations on an open database connection.
 * foreign_keys is disabled during migration and re-enabled after.
 * Each migration step runs in a transaction that also updates user_version.
 * @param enforceMigrations If true, when fromVersion === 0, apply migrations from 0 to CURRENT_VERSION
 *                          instead of loading schema.sql. Useful for generating schema.
 */
export function migrateDatabase(db: Database, enforceMigrations = false): void {
  db.pragma('foreign_keys = OFF')
  const fromVersion = db.pragma('user_version', { simple: true }) as number

  // Fresh database – load schema.sql and set version to CURRENT_VERSION
  if (fromVersion === 0 && !enforceMigrations) {
    console.log(`[db] creating fresh database from schema.sql (version ${CURRENT_VERSION})`)
    loadSchemaFromFile(db)
    db.pragma(`user_version = ${CURRENT_VERSION}`)
    db.pragma('foreign_keys = ON')
    return
  }

  // If enforceMigrations is true and fromVersion === 0, we fall through to apply migrations.
  for (let v = fromVersion; v < CURRENT_VERSION; v++) {
    db.transaction(() => {
      MIGRATIONS[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })()
    console.log(`[db] migrated schema: ${v} → ${v + 1}`)
  }

  db.pragma('foreign_keys = ON')
}
