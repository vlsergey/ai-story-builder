import type { Database } from 'better-sqlite3'

// Each entry migrates the DB from version N to N+1.
// Index 0: 0 → 1, index 1: 1 → 2, etc.
const MIGRATIONS: Array<(db: Database) => void> = [
  // version 0 → 1: initial schema
  (db) => {
    db.exec(`
      -- Unified lore tree.
      -- A node with children acts as a folder; a node with versions holds content.
      -- There is no separate node_type — behaviour emerges from usage.
      CREATE TABLE lore_nodes (
        id             INTEGER PRIMARY KEY,
        parent_id      INTEGER NULL REFERENCES lore_nodes(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        content        TEXT,
        position       INTEGER DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'ACTIVE',
        to_be_deleted  INTEGER NOT NULL DEFAULT 0,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (parent_id, name)
      );

      CREATE TABLE lore_versions (
        id           INTEGER PRIMARY KEY,
        lore_node_id INTEGER NOT NULL REFERENCES lore_nodes(id) ON DELETE CASCADE,
        version      INTEGER NOT NULL,
        content      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (lore_node_id, version)
      );

      CREATE TABLE plan_nodes (
        id            INTEGER PRIMARY KEY,
        parent_id     INTEGER NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        content       TEXT,
        position      INTEGER DEFAULT 0,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        type          TEXT NOT NULL DEFAULT 'text',
        x             REAL DEFAULT 0,
        y             REAL DEFAULT 0,
        user_prompt   TEXT,
        system_prompt TEXT,
        summary       TEXT,
        auto_summary  INTEGER DEFAULT 0,
        ai_sync_info  TEXT
      );

      CREATE TABLE plan_edges (
        id           INTEGER PRIMARY KEY,
        from_node_id INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
        to_node_id   INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
        type         TEXT NOT NULL DEFAULT 'instruction',
        position     INTEGER DEFAULT 0,
        label        TEXT,
        template     TEXT
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
        data               JSON NOT NULL,
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
  // version 1 → 2: add word/char/byte counts and AI sync info to lore_nodes
  (db) => {
    db.exec(`
      ALTER TABLE lore_nodes ADD COLUMN word_count  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE lore_nodes ADD COLUMN char_count  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE lore_nodes ADD COLUMN byte_count  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE lore_nodes ADD COLUMN ai_sync_info TEXT NULL;
    `)
  },
  // version 2 → 3: backfill word/char/byte counts for existing lore_nodes with content
  (db) => {
    const rows = db
      .prepare('SELECT id, content FROM lore_nodes WHERE content IS NOT NULL')
      .all() as { id: number; content: string }[]
    const update = db.prepare(
      'UPDATE lore_nodes SET word_count = ?, char_count = ?, byte_count = ? WHERE id = ?'
    )
    for (const row of rows) {
      const t = row.content.trim()
      const words = t === '' ? 0 : t.split(/\s+/).length
      const chars = [...row.content].length
      const bytes = Buffer.byteLength(row.content, 'utf8')
      update.run(words, chars, bytes, row.id)
    }
  },
  // version 3 → 4: add text_language setting (default ru-RU) for existing projects
  (db) => {
    db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('text_language', 'ru-RU')`)
  },
  // version 4 → 5: reset Grok sync state
  // Files uploaded before this migration may have been created without purpose:'assistants',
  // making them unusable with the Responses API file attachment. Clear all grok entries so the
  // next sync re-uploads every file with the correct purpose.
  (db) => {
    const rows = db
      .prepare("SELECT id, ai_sync_info FROM lore_nodes WHERE ai_sync_info IS NOT NULL")
      .all() as { id: number; ai_sync_info: string }[]
    const update = db.prepare('UPDATE lore_nodes SET ai_sync_info = ? WHERE id = ?')
    for (const row of rows) {
      try {
        const info = JSON.parse(row.ai_sync_info) as Record<string, unknown>
        if (!('grok' in info)) continue
        delete info['grok']
        const newValue = Object.keys(info).length > 0 ? JSON.stringify(info) : null
        update.run(newValue, row.id)
      } catch { /* skip malformed JSON */ }
    }
  },
  // version 5 → 6: add source, prompt, response_id to lore_versions
  (db) => {
    db.exec(`
      ALTER TABLE lore_versions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE lore_versions ADD COLUMN prompt TEXT NULL;
      ALTER TABLE lore_versions ADD COLUMN response_id TEXT NULL;
    `)
  },
  // version 6 → 7: add review workflow columns to lore_nodes
  (db) => {
    db.exec(`
      ALTER TABLE lore_nodes ADD COLUMN changes_status TEXT NULL;
      ALTER TABLE lore_nodes ADD COLUMN review_base_content TEXT NULL;
    `)
  },
  // version 7 → 8: remove lore_versions and plan_node_versions tables; add last_improve_instruction to lore_nodes
  (db) => {
    db.exec(`
      DROP TABLE IF EXISTS lore_versions;
      DROP TABLE IF EXISTS plan_node_versions;
      ALTER TABLE lore_nodes ADD COLUMN last_improve_instruction TEXT NULL;
    `)
  },
  // version 8 → 9: add stats + review workflow columns to plan_nodes; backfill counts
  // (note: last_generate_prompt was added in the next migration step)
  (db) => {
    db.exec(`
      ALTER TABLE plan_nodes ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plan_nodes ADD COLUMN char_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plan_nodes ADD COLUMN byte_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plan_nodes ADD COLUMN changes_status TEXT NULL;
      ALTER TABLE plan_nodes ADD COLUMN review_base_content TEXT NULL;
      ALTER TABLE plan_nodes ADD COLUMN last_improve_instruction TEXT NULL;
    `)
    const rows = db
      .prepare('SELECT id, content FROM plan_nodes WHERE content IS NOT NULL')
      .all() as { id: number; content: string }[]
    const update = db.prepare(
      'UPDATE plan_nodes SET word_count = ?, char_count = ?, byte_count = ? WHERE id = ?'
    )
    for (const row of rows) {
      const t = row.content.trim()
      const words = t === '' ? 0 : t.split(/\s+/).length
      const chars = [...row.content].length
      const bytes = Buffer.byteLength(row.content, 'utf8')
      update.run(words, chars, bytes, row.id)
    }
  },
  // version 9 → 10: add last_generate_prompt to lore_nodes and plan_nodes
  (db) => {
    db.exec(`
      ALTER TABLE lore_nodes ADD COLUMN last_generate_prompt TEXT NULL;
      ALTER TABLE plan_nodes ADD COLUMN last_generate_prompt TEXT NULL;
    `)
  },
  // version 10 → 11: drop ai_calls table (was never populated, logging not used)
  (db) => {
    db.exec(`DROP TABLE IF EXISTS ai_calls`)
  },
  // version 11 → 12: add graph columns to plan_nodes + plan_edges table
  // Uses IF NOT EXISTS / conditional guards because fresh DBs already have these columns.
  (db) => {
    const existingCols = (db.pragma('table_info(plan_nodes)') as { name: string }[]).map(c => c.name)
    const addIfMissing = (col: string, def: string) => {
      if (!existingCols.includes(col)) {
        db.exec(`ALTER TABLE plan_nodes ADD COLUMN ${col} ${def}`)
      }
    }
    addIfMissing('type', 'TEXT NOT NULL DEFAULT \'text\'')
    addIfMissing('x', 'REAL DEFAULT 0')
    addIfMissing('y', 'REAL DEFAULT 0')
    addIfMissing('user_prompt', 'TEXT')
    addIfMissing('system_prompt', 'TEXT')
    addIfMissing('summary', 'TEXT')
    addIfMissing('auto_summary', 'INTEGER DEFAULT 0')
    addIfMissing('ai_sync_info', 'TEXT')

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_edges'").all() as { name: string }[])
    if (tables.length === 0) {
      db.exec(`
        CREATE TABLE plan_edges (
          id           INTEGER PRIMARY KEY,
          from_node_id INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
          to_node_id   INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
          type         TEXT NOT NULL DEFAULT 'instruction',
          position     INTEGER DEFAULT 0,
          label        TEXT,
          template     TEXT
        )
      `)
      // Migrate parent-child relationships → instruction edges
      const rows = db.prepare(
        `SELECT id, parent_id, position FROM plan_nodes WHERE parent_id IS NOT NULL`
      ).all() as Array<{ id: number; parent_id: number; position: number }>
      const insert = db.prepare(
        `INSERT INTO plan_edges (from_node_id, to_node_id, type, position) VALUES (?, ?, 'instruction', ?)`
      )
      for (const r of rows) insert.run(r.parent_id, r.id, r.position)
    }
  },
  // version 12 → 13: copy last_generate_prompt to user_prompt for plan nodes, add user_prompt and system_prompt to lore_nodes
  (db) => {
    // 1. Ensure lore_nodes has user_prompt column (copy from last_generate_prompt)
    const loreCols = (db.pragma('table_info(lore_nodes)') as { name: string }[]).map(c => c.name)
    if (!loreCols.includes('user_prompt')) {
      db.exec('ALTER TABLE lore_nodes ADD COLUMN user_prompt TEXT NULL')
      // Copy existing last_generate_prompt values
      db.exec('UPDATE lore_nodes SET user_prompt = last_generate_prompt WHERE last_generate_prompt IS NOT NULL')
    }
    if (!loreCols.includes('system_prompt')) {
      db.exec('ALTER TABLE lore_nodes ADD COLUMN system_prompt TEXT NULL')
    }

    // 2. For plan nodes, copy last_generate_prompt to user_prompt where user_prompt is NULL
    const planRows = db
      .prepare('SELECT id, last_generate_prompt FROM plan_nodes WHERE last_generate_prompt IS NOT NULL AND user_prompt IS NULL')
      .all() as { id: number; last_generate_prompt: string }[]
    const updatePlan = db.prepare('UPDATE plan_nodes SET user_prompt = ? WHERE id = ?')
    for (const row of planRows) {
      updatePlan.run(row.last_generate_prompt, row.id)
    }
  },
  // version 13 → 14: drop last_generate_prompt column from both tables
  (db) => {
    // Drop from lore_nodes
    const loreCols = (db.pragma('table_info(lore_nodes)') as { name: string }[]).map(c => c.name)
    if (loreCols.includes('last_generate_prompt')) {
      db.exec('ALTER TABLE lore_nodes DROP COLUMN last_generate_prompt')
    }
    // Drop from plan_nodes
    const planCols = (db.pragma('table_info(plan_nodes)') as { name: string }[]).map(c => c.name)
    if (planCols.includes('last_generate_prompt')) {
      db.exec('ALTER TABLE plan_nodes DROP COLUMN last_generate_prompt')
    }
  },
]

export const CURRENT_VERSION = MIGRATIONS.length

/**
 * Runs all pending migrations on an open database connection.
 * foreign_keys is disabled during migration and re-enabled after.
 * Each migration step runs in a transaction that also updates user_version.
 */
export function migrateDatabase(db: Database): void {
  db.pragma('foreign_keys = OFF')
  const fromVersion = db.pragma('user_version', { simple: true }) as number

  for (let v = fromVersion; v < CURRENT_VERSION; v++) {
    db.transaction(() => {
      MIGRATIONS[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })()
    console.log(`[db] migrated schema: ${v} → ${v + 1}`)
  }

  db.pragma('foreign_keys = ON')
}
