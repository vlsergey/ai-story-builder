import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // 1. Remove auto_summary column from plan_nodes if it exists
  const planCols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (planCols.includes("auto_summary")) {
    db.exec("ALTER TABLE plan_nodes DROP COLUMN auto_summary")
    console.log("Dropped auto_summary column from plan_nodes")
  }
}
