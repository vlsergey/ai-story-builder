import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // 2. Rename `name` to `title` if `name` exists
  const loreColumns = (db.pragma("table_info(lore_nodes)") as { name: string }[]).map((c) => c.name)
  if (loreColumns.includes("name") && !loreColumns.includes("title")) {
    db.exec("ALTER TABLE lore_nodes RENAME COLUMN name TO title")
    console.log("Renamed `name` to `title` in lore_nodes")
  }
  if (loreColumns.includes("last_improve_instruction") && !loreColumns.includes("ai_improve_instruction")) {
    db.exec("ALTER TABLE lore_nodes RENAME COLUMN last_improve_instruction TO ai_improve_instruction")
    console.log("Renamed `last_improve_instruction` to `ai_improve_instruction` in lore_nodes")
  }

  if (loreColumns.includes("changes_status") && !loreColumns.includes("in_review")) {
    db.exec("ALTER TABLE lore_nodes DROP COLUMN changes_status")
    db.exec("ALTER TABLE lore_nodes ADD COLUMN in_review INTEGER NOT NULL DEFAULT 0")
    console.log("`changes_status` changed to `in_review` in lore_nodes")
  }

  const planColumns = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (planColumns.includes("last_improve_instruction") && !planColumns.includes("ai_improve_instruction")) {
    db.exec("ALTER TABLE plan_nodes RENAME COLUMN last_improve_instruction TO ai_improve_instruction")
    console.log("Renamed `last_improve_instruction` to `ai_improve_instruction` in plan_nodes")
  }

  if (planColumns.includes("changes_status") && !planColumns.includes("in_review")) {
    db.exec("ALTER TABLE plan_nodes DROP COLUMN changes_status")
    db.exec("ALTER TABLE plan_nodes ADD COLUMN in_review INTEGER NOT NULL DEFAULT 0")
    console.log("`changes_status` changed to `in_review` in plan_nodes")
  }
}
