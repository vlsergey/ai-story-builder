import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // 1. Remove system_prompt column from lore_nodes if it exists
  const loreCols = (db.pragma("table_info(lore_nodes)") as { name: string }[]).map((c) => c.name)
  if (loreCols.includes("system_prompt")) {
    db.exec("ALTER TABLE lore_nodes DROP COLUMN system_prompt")
    console.log("Dropped system_prompt column from lore_nodes")
  }

  // 2. Rename user_prompt to ai_instructions if user_prompt exists
  const loreColsAfter = (db.pragma("table_info(lore_nodes)") as { name: string }[]).map((c) => c.name)
  if (loreColsAfter.includes("user_prompt") && !loreColsAfter.includes("ai_instructions")) {
    db.exec("ALTER TABLE lore_nodes RENAME COLUMN user_prompt TO ai_instructions")
    console.log("Renamed user_prompt to ai_instructions in lore_nodes")
  }
}
