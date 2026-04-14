import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  db.exec(`
    ALTER TABLE lore_nodes ADD COLUMN changes_status TEXT NULL;
    ALTER TABLE lore_nodes ADD COLUMN review_base_content TEXT NULL;
  `)
}
