import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  db.exec(`
    ALTER TABLE lore_nodes ADD COLUMN word_count  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE lore_nodes ADD COLUMN char_count  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE lore_nodes ADD COLUMN byte_count  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE lore_nodes ADD COLUMN ai_sync_info TEXT NULL;
  `)
}
