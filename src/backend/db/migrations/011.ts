import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS ai_calls`)
}