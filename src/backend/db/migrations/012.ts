import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
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
}