import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  // 1. Remove system_prompt column from plan_nodes if it exists
  const planCols = (db.pragma('table_info(plan_nodes)') as { name: string }[]).map(c => c.name);
  if (planCols.includes('system_prompt')) {
    // SQLite does not support DROP COLUMN directly, need to recreate table.
    // Use the standard approach: create new table without the column, copy data, drop old, rename.
    // However, to keep migration simple and safe, we can just ignore the column (mark as unused)
    // and rely on application code to stop using it.
    // Alternatively, we can rename the column to deprecated_system_prompt to avoid data loss.
    // Since backward compatibility is not required, we can drop the column using the following steps:
    // This is a complex operation; we'll follow the pattern used in other migrations (e.g., 017.ts)
    // where they used RENAME COLUMN. For dropping, we need to recreate table.
    // Let's implement a safe drop using temporary table.
    db.exec(`
      CREATE TABLE plan_nodes_new (
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
        summary       TEXT,
        auto_summary  INTEGER DEFAULT 0,
        ai_sync_info  TEXT,
        word_count    INTEGER NOT NULL DEFAULT 0,
        char_count    INTEGER NOT NULL DEFAULT 0,
        byte_count    INTEGER NOT NULL DEFAULT 0,
        changes_status TEXT NULL,
        review_base_content TEXT NULL,
        last_improve_instruction TEXT NULL,
        node_type_settings TEXT NULL,
        status        TEXT NOT NULL DEFAULT 'EMPTY',
        ai_settings   TEXT
      )
    `);
    // Copy data excluding system_prompt column
    const columnsToCopy = planCols.filter(c => c !== 'system_prompt').join(', ');
    db.exec(`INSERT INTO plan_nodes_new (${columnsToCopy}) SELECT ${columnsToCopy} FROM plan_nodes`);
    db.exec('DROP TABLE plan_nodes');
    db.exec('ALTER TABLE plan_nodes_new RENAME TO plan_nodes');
    console.log('Dropped system_prompt column from plan_nodes');
  }

  // 2. Rename user_prompt to ai_instructions if user_prompt exists
  const planColsAfter = (db.pragma('table_info(plan_nodes)') as { name: string }[]).map(c => c.name);
  if (planColsAfter.includes('user_prompt') && !planColsAfter.includes('ai_instructions')) {
    db.exec('ALTER TABLE plan_nodes RENAME COLUMN user_prompt TO ai_instructions');
    console.log('Renamed user_prompt to ai_instructions in plan_nodes');
  }

  // 3. Update ai_config to add generateSummaryInstructions field (optional)
  // We'll leave it empty, so summary generation will be disabled until user configures it.
  // No action needed because the field is optional in the interface.
}