import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  const rows = db.prepare("SELECT id, ai_sync_info FROM lore_nodes WHERE ai_sync_info IS NOT NULL").all() as {
    id: number
    ai_sync_info: string
  }[]
  const update = db.prepare("UPDATE lore_nodes SET ai_sync_info = ? WHERE id = ?")
  for (const row of rows) {
    try {
      const info = JSON.parse(row.ai_sync_info) as Record<string, unknown>
      if (!("grok" in info)) continue
      delete info["grok"]
      const newValue = Object.keys(info).length > 0 ? JSON.stringify(info) : null
      update.run(newValue, row.id)
    } catch {
      /* skip malformed JSON */
    }
  }
}
