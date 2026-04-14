import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // 1. Ensure lore_nodes has user_prompt column (copy from last_generate_prompt)
  const loreCols = (db.pragma("table_info(lore_nodes)") as { name: string }[]).map((c) => c.name)
  if (!loreCols.includes("user_prompt")) {
    db.exec("ALTER TABLE lore_nodes ADD COLUMN user_prompt TEXT NULL")
    // Copy existing last_generate_prompt values
    db.exec("UPDATE lore_nodes SET user_prompt = last_generate_prompt WHERE last_generate_prompt IS NOT NULL")
  }
  if (!loreCols.includes("system_prompt")) {
    db.exec("ALTER TABLE lore_nodes ADD COLUMN system_prompt TEXT NULL")
  }

  // 2. For plan nodes, copy last_generate_prompt to user_prompt where user_prompt is NULL
  const planRows = db
    .prepare(
      "SELECT id, last_generate_prompt FROM plan_nodes WHERE last_generate_prompt IS NOT NULL AND user_prompt IS NULL",
    )
    .all() as { id: number; last_generate_prompt: string }[]
  const updatePlan = db.prepare("UPDATE plan_nodes SET user_prompt = ? WHERE id = ?")
  for (const row of planRows) {
    updatePlan.run(row.last_generate_prompt, row.id)
  }
}
