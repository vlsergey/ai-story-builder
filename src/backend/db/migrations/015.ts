import type { Database } from "better-sqlite3"

export default function migration(db: Database): void {
  // Add merge_settings column to plan_nodes
  const planCols = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  if (!planCols.includes("merge_settings")) {
    db.exec("ALTER TABLE plan_nodes ADD COLUMN merge_settings TEXT NULL")
  }

  // Update plan_nodes type to support 'merge' type
  if (!planCols.includes("type")) {
    db.exec("ALTER TABLE plan_nodes ADD COLUMN type TEXT NOT NULL DEFAULT 'text'")
  }

  // Migrate existing merge node settings from settings table to plan_nodes.merge_settings
  const settingsRows = db
    .prepare(`
    SELECT key, value
    FROM settings
    WHERE key LIKE 'merge_node_%'
  `)
    .all() as { key: string; value: string }[]

  const updateNode = db.prepare(`
    UPDATE plan_nodes
    SET merge_settings = ?, type = 'merge'
    WHERE id = ?
  `)

  for (const row of settingsRows) {
    const nodeId = parseInt(row.key.replace("merge_node_", ""), 10)
    if (!isNaN(nodeId)) {
      try {
        // Parse the settings and store in merge_settings column
        const settings = JSON.parse(row.value)
        updateNode.run(JSON.stringify(settings), nodeId)
      } catch (error) {
        console.error(`Failed to migrate settings for node ${nodeId}:`, error)
      }
    }
  }

  // Remove the migrated settings from the settings table
  db.exec("DELETE FROM settings WHERE key LIKE 'merge_node_%'")
}
