import type { Database } from "better-sqlite3"

/**
 * Move `ai_user_prompt` and `ai_system_prompt` off the plan_nodes row and into
 * `node_type_settings` JSON for the LLM-calling node types (text, split, lore).
 *
 * For non-LLM types (merge, for-each*, for-each-prev-outputs, fix-problems —
 * which keeps its prompts in node_type_settings under different keys), any
 * non-null prompt is logged with a WARN and dropped. The full text is printed
 * so it can be recovered from migration logs if it turns out to have been
 * meaningful.
 *
 * After the data move, the two columns are dropped from `plan_nodes`.
 *
 * `lore_nodes` is intentionally not touched: it has no `node_type_settings`
 * infrastructure (single record type) and is a separate subsystem.
 */
const LLM_TYPES = new Set(["text", "split", "lore"])

interface Row {
  id: number
  type: string
  ai_user_prompt: string | null
  ai_system_prompt: string | null
  node_type_settings: string | null
}

export default function migration(db: Database): void {
  const cols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  const hasUser = cols.includes("ai_user_prompt")
  const hasSystem = cols.includes("ai_system_prompt")
  if (!hasUser && !hasSystem) {
    // Nothing to do (already migrated, defensive against re-runs).
    return
  }

  const rows = db
    .prepare(
      `SELECT id, type, ai_user_prompt, ai_system_prompt, node_type_settings FROM plan_nodes
        WHERE ai_user_prompt IS NOT NULL OR ai_system_prompt IS NOT NULL`,
    )
    .all() as Row[]

  const update = db.prepare(`UPDATE plan_nodes SET node_type_settings = ? WHERE id = ?`)

  for (const row of rows) {
    if (LLM_TYPES.has(row.type)) {
      let parsed: Record<string, unknown> = {}
      if (row.node_type_settings) {
        try {
          const obj = JSON.parse(row.node_type_settings)
          if (obj && typeof obj === "object" && !Array.isArray(obj)) {
            parsed = obj as Record<string, unknown>
          }
        } catch {
          console.warn(
            `[migration 028] plan_node id=${row.id} type=${row.type} has invalid JSON in node_type_settings; replacing with prompts only`,
          )
        }
      }
      if (row.ai_user_prompt !== null) parsed.userPrompt = row.ai_user_prompt
      if (row.ai_system_prompt !== null) parsed.systemPrompt = row.ai_system_prompt
      update.run(JSON.stringify(parsed), row.id)
    } else {
      if (row.ai_user_prompt !== null) {
        console.warn(
          `[migration 028] plan_node id=${row.id} type=${row.type} had ai_user_prompt — dropping. Original value follows:\n${row.ai_user_prompt}`,
        )
      }
      if (row.ai_system_prompt !== null) {
        console.warn(
          `[migration 028] plan_node id=${row.id} type=${row.type} had ai_system_prompt — dropping. Original value follows:\n${row.ai_system_prompt}`,
        )
      }
    }
  }

  if (hasUser) db.exec("ALTER TABLE plan_nodes DROP COLUMN ai_user_prompt")
  if (hasSystem) db.exec("ALTER TABLE plan_nodes DROP COLUMN ai_system_prompt")
}
