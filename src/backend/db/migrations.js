'use strict'

// Each entry migrates the DB from version N to N+1.
// Index 0: 0 → 1, index 1: 1 → 2, etc.
const MIGRATIONS = [
  // version 0 → 1: initial schema
  (db) => {
    db.exec(`
      CREATE TABLE lore_folders (
        id        INTEGER PRIMARY KEY,
        parent_id INTEGER NULL REFERENCES lore_folders(id) ON DELETE CASCADE,
        name      TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (parent_id, name)
      );

      CREATE TABLE lore_items (
        id        INTEGER PRIMARY KEY,
        folder_id INTEGER NOT NULL REFERENCES lore_folders(id) ON DELETE CASCADE,
        slug      TEXT NOT NULL,
        title     TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (folder_id, slug)
      );

      CREATE TABLE lore_versions (
        id           INTEGER PRIMARY KEY,
        lore_item_id INTEGER NOT NULL REFERENCES lore_items(id) ON DELETE CASCADE,
        version      INTEGER NOT NULL,
        content      TEXT NOT NULL,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (lore_item_id, version)
      );

      CREATE TABLE plan_nodes (
        id        INTEGER PRIMARY KEY,
        parent_id INTEGER NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
        title     TEXT NOT NULL,
        position  INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE plan_node_versions (
        id              INTEGER PRIMARY KEY,
        plan_node_id    INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
        version         INTEGER NOT NULL,
        instruction     TEXT NOT NULL,
        result          TEXT,
        status          TEXT NOT NULL DEFAULT 'DRAFT',
        parent_version_id INTEGER NULL REFERENCES plan_node_versions(id),
        is_obsolete     BOOLEAN DEFAULT FALSE,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (plan_node_id, version)
      );

      CREATE TABLE story_parts (
        id                  INTEGER PRIMARY KEY,
        plan_node_version_id INTEGER NOT NULL REFERENCES plan_node_versions(id) ON DELETE CASCADE,
        version             INTEGER NOT NULL,
        content             TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'GENERATED',
        parent_version_id   INTEGER NULL REFERENCES story_parts(id),
        is_obsolete         BOOLEAN DEFAULT FALSE,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (plan_node_version_id, version)
      );

      CREATE TABLE card_definitions (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        definition TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE card_values (
        id                 INTEGER PRIMARY KEY,
        card_definition_id INTEGER NOT NULL REFERENCES card_definitions(id) ON DELETE CASCADE,
        story_part_id      INTEGER NOT NULL REFERENCES story_parts(id) ON DELETE CASCADE,
        version            INTEGER NOT NULL,
        values             JSON NOT NULL,
        parent_version_id  INTEGER NULL REFERENCES card_values(id),
        is_obsolete        BOOLEAN DEFAULT FALSE,
        created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (card_definition_id, story_part_id, version)
      );

      CREATE TABLE ai_calls (
        id                   INTEGER PRIMARY KEY,
        backend              TEXT NOT NULL,
        model                TEXT NOT NULL,
        request_type         TEXT,
        prompt               TEXT,
        response_summary     TEXT,
        tokens_input         INTEGER,
        tokens_output        INTEGER,
        cost                 REAL,
        related_story_part_id INTEGER NULL REFERENCES story_parts(id),
        created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  },
]

const CURRENT_VERSION = MIGRATIONS.length

/**
 * Runs all pending migrations on an open database connection.
 * foreign_keys is disabled during migration and re-enabled after.
 * Each migration step runs in a transaction that also updates user_version.
 * @param {import('better-sqlite3').Database} db
 */
function migrateDatabase(db) {
  db.pragma('foreign_keys = OFF')
  const fromVersion = db.pragma('user_version', { simple: true })

  for (let v = fromVersion; v < CURRENT_VERSION; v++) {
    db.transaction(() => {
      MIGRATIONS[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })()
    console.log(`[db] migrated schema: ${v} → ${v + 1}`)
  }

  db.pragma('foreign_keys = ON')
}

module.exports = { migrateDatabase, CURRENT_VERSION }
