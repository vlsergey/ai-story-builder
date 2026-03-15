import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  db.exec(`
    ALTER TABLE lore_versions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE lore_versions ADD COLUMN prompt TEXT NULL;
    ALTER TABLE lore_versions ADD COLUMN response_id TEXT NULL;
  `)
}