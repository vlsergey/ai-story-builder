import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  db.exec(`
    ALTER TABLE plan_nodes ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE plan_nodes ADD COLUMN char_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE plan_nodes ADD COLUMN byte_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE plan_nodes ADD COLUMN changes_status TEXT NULL;
    ALTER TABLE plan_nodes ADD COLUMN review_base_content TEXT NULL;
    ALTER TABLE plan_nodes ADD COLUMN last_improve_instruction TEXT NULL;
  `)
  const rows = db
    .prepare('SELECT id, content FROM plan_nodes WHERE content IS NOT NULL')
    .all() as { id: number; content: string }[]
  const update = db.prepare(
    'UPDATE plan_nodes SET word_count = ?, char_count = ?, byte_count = ? WHERE id = ?'
  )
  for (const row of rows) {
    const t = row.content.trim()
    const words = t === '' ? 0 : t.split(/\s+/).length
    const chars = [...row.content].length
    const bytes = Buffer.byteLength(row.content, 'utf8')
    update.run(words, chars, bytes, row.id)
  }
}