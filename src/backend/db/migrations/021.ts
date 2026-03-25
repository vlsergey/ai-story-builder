import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  // 1. Remove system_prompt column from lore_nodes if it exists
  const loreCols = (db.pragma('table_info(lore_nodes)') as { name: string }[]).map(c => c.name);
  if (loreCols.includes('system_prompt')) {
    // SQLite does not support DROP COLUMN directly, need to recreate table.
    // Create new table without system_prompt column.
    db.exec(`
      CREATE TABLE lore_nodes_new (
        id             INTEGER PRIMARY KEY,
        parent_id      INTEGER NULL REFERENCES lore_nodes(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        content        TEXT,
        position       INTEGER DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'ACTIVE',
        to_be_deleted  INTEGER NOT NULL DEFAULT 0,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        word_count     INTEGER NOT NULL DEFAULT 0,
        char_count     INTEGER NOT NULL DEFAULT 0,
        byte_count     INTEGER NOT NULL DEFAULT 0,
        ai_sync_info   TEXT NULL,
        changes_status TEXT NULL,
        review_base_content TEXT NULL,
        last_improve_instruction TEXT NULL,
        user_prompt    TEXT NULL,
        ai_settings    TEXT
      )
    `);
    // Copy data excluding system_prompt column
    const columnsToCopy = loreCols.filter(c => c !== 'system_prompt').join(', ');
    db.exec(`INSERT INTO lore_nodes_new (${columnsToCopy}) SELECT ${columnsToCopy} FROM lore_nodes`);
    db.exec('DROP TABLE lore_nodes');
    db.exec('ALTER TABLE lore_nodes_new RENAME TO lore_nodes');
    console.log('Dropped system_prompt column from lore_nodes');
  }

  // 2. Rename user_prompt to ai_instructions if user_prompt exists
  const loreColsAfter = (db.pragma('table_info(lore_nodes)') as { name: string }[]).map(c => c.name);
  if (loreColsAfter.includes('user_prompt') && !loreColsAfter.includes('ai_instructions')) {
    db.exec('ALTER TABLE lore_nodes RENAME COLUMN user_prompt TO ai_instructions');
    console.log('Renamed user_prompt to ai_instructions in lore_nodes');
  }
}