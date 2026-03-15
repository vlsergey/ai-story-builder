import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  db.exec(`
    ALTER TABLE lore_nodes ADD COLUMN last_generate_prompt TEXT NULL;
    ALTER TABLE plan_nodes ADD COLUMN last_generate_prompt TEXT NULL;
  `)
}