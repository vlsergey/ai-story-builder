import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
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
}