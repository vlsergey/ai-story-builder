import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  // Check if column exists in plan_nodes
  const planCols = (db.pragma('table_info(plan_nodes)') as { name: string }[]).map(c => c.name);
  if (!planCols.includes('ai_settings')) {
    db.exec('ALTER TABLE plan_nodes ADD COLUMN ai_settings TEXT');
  }

  // Check if column exists in lore_nodes
  const loreCols = (db.pragma('table_info(lore_nodes)') as { name: string }[]).map(c => c.name);
  if (!loreCols.includes('ai_settings')) {
    db.exec('ALTER TABLE lore_nodes ADD COLUMN ai_settings TEXT');
  }
}