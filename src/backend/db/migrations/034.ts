import type { Database } from "better-sqlite3"

/**
 * Telemetry names the node and the iteration a call was made for. With one
 * state per iteration, calls of one node in different iterations are
 * different visits; the title alone cannot tell them apart once iterations
 * run side by side.
 */
export default function migration(db: Database): void {
  const columns = (db.pragma("table_info(ai_call_stats)") as { name: string }[]).map((c) => c.name)
  if (!columns.includes("node_id")) db.exec("ALTER TABLE ai_call_stats ADD COLUMN node_id INTEGER")
  if (!columns.includes("path")) db.exec("ALTER TABLE ai_call_stats ADD COLUMN path TEXT")
}
