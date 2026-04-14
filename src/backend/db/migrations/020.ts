import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // 1. Remove system_prompt column from plan_nodes if it exists
  const planCols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (planCols.includes("system_prompt")) {
    db.exec("ALTER TABLE plan_nodes DROP COLUMN system_prompt")
    console.log("Dropped system_prompt column from plan_nodes")
  }

  // 2. Rename user_prompt to ai_instructions if user_prompt exists
  const planColsAfter = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (planColsAfter.includes("user_prompt") && !planColsAfter.includes("ai_instructions")) {
    db.exec("ALTER TABLE plan_nodes RENAME COLUMN user_prompt TO ai_instructions")
    console.log("Renamed user_prompt to ai_instructions in plan_nodes")
  }

  // 3. Update ai_config to add generateSummaryInstructions field (optional)
  // We'll leave it empty, so summary generation will be disabled until user configures it.
  // No action needed because the field is optional in the interface.
}
