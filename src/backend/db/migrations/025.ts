import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  // Add width and height columns to plan_nodes table
  const planCols = (db.pragma('table_info(plan_nodes)') as { name: string }[]).map(c => c.name);
  
  // Add width column if missing
  if (!planCols.includes('width')) {
    db.exec('ALTER TABLE plan_nodes ADD COLUMN width INTEGER NULL');
    console.log('Added width column to plan_nodes');
  }
  
  // Add height column if missing
  if (!planCols.includes('height')) {
    db.exec('ALTER TABLE plan_nodes ADD COLUMN height INTEGER NULL');
    console.log('Added height column to plan_nodes');
  }
  
  // Also add to lore_nodes for consistency (optional)
  const loreCols = (db.pragma('table_info(lore_nodes)') as { name: string }[]).map(c => c.name);
  
  if (!loreCols.includes('width')) {
    db.exec('ALTER TABLE lore_nodes ADD COLUMN width INTEGER NULL');
    console.log('Added width column to lore_nodes');
  }
  
  if (!loreCols.includes('height')) {
    db.exec('ALTER TABLE lore_nodes ADD COLUMN height INTEGER NULL');
    console.log('Added height column to lore_nodes');
  }
}