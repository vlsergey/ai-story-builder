import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // Check if column exists
  const planCols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (!planCols.includes("status")) {
    // Add status column with default 'EMPTY'
    db.exec("ALTER TABLE plan_nodes ADD COLUMN status TEXT NOT NULL DEFAULT 'EMPTY'")
  }

  // Backfill status based on content
  // If content is NULL or empty string -> EMPTY
  // If content is not empty -> MANUAL (since we cannot distinguish generated vs manual)
  // However, we can also check if node has changes_status = 'review'? Not needed.
  db.exec(`
    UPDATE plan_nodes
    SET status = CASE
      WHEN content IS NULL OR trim(content) = '' THEN 'EMPTY'
      ELSE 'MANUAL'
    END
  `)
}
