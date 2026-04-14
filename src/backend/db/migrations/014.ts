import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // Drop from lore_nodes
  const loreCols = (db.pragma("table_info(lore_nodes)") as { name: string }[]).map((c) => c.name)
  if (loreCols.includes("last_generate_prompt")) {
    db.exec("ALTER TABLE lore_nodes DROP COLUMN last_generate_prompt")
  }
  // Drop from plan_nodes
  const planCols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (planCols.includes("last_generate_prompt")) {
    db.exec("ALTER TABLE plan_nodes DROP COLUMN last_generate_prompt")
  }
}
