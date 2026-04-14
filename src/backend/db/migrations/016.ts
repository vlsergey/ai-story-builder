import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // Create a new table with the correct default
  db.exec(`
    CREATE TABLE plan_edges_new (
      id           INTEGER PRIMARY KEY,
      from_node_id INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
      to_node_id   INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
      type         TEXT NOT NULL DEFAULT 'text',
      position     INTEGER DEFAULT 0,
      label        TEXT,
      template     TEXT
    )
  `)

  // Copy all existing edges, converting any type to 'text'
  db.exec(`
    INSERT INTO plan_edges_new (id, from_node_id, to_node_id, type, position, label, template)
    SELECT id, from_node_id, to_node_id, 'text', position, label, template
    FROM plan_edges
  `)

  // Drop the old table
  db.exec("DROP TABLE plan_edges")

  // Rename new table to original name
  db.exec("ALTER TABLE plan_edges_new RENAME TO plan_edges")
}
