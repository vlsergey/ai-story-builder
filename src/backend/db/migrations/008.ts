import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  db.exec(`
    DROP TABLE IF EXISTS lore_versions;
    DROP TABLE IF EXISTS plan_node_versions;
    ALTER TABLE lore_nodes ADD COLUMN last_improve_instruction TEXT NULL;
  `)
}
