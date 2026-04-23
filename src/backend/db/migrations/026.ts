import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  db.exec(`DELETE FROM settings WHERE key='text_language'`)

  db.exec(
    `UPDATE settings SET value=json(value) ` +
      `WHERE value NOT NULL AND trim(value) NOT IN ('true', 'false', 'null') AND value NOT LIKE '{%' AND value NOT LIKE '"%'`,
  )
}
