import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  const rows = db
    .prepare('SELECT id, content FROM lore_nodes WHERE content IS NOT NULL')
    .all() as { id: number; content: string }[]
  const update = db.prepare(
    'UPDATE lore_nodes SET word_count = ?, char_count = ?, byte_count = ? WHERE id = ?'
  )
  for (const row of rows) {
    const t = row.content.trim()
    const words = t === '' ? 0 : t.split(/\s+/).length
    const chars = [...row.content].length
    const bytes = Buffer.byteLength(row.content, 'utf8')
    update.run(words, chars, bytes, row.id)
  }
}