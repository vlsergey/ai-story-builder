import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('text_language', 'ru-RU')`)
}
