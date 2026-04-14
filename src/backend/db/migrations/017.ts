import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // Check if column exists
  const planCols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (planCols.includes("merge_settings")) {
    // SQLite 3.25.0+ supports RENAME COLUMN
    db.exec("ALTER TABLE plan_nodes RENAME COLUMN merge_settings TO node_type_settings")
  } else if (!planCols.includes("node_type_settings")) {
    // If merge_settings column is missing (should not happen), add node_type_settings
    db.exec("ALTER TABLE plan_nodes ADD COLUMN node_type_settings TEXT NULL")
  }
}
