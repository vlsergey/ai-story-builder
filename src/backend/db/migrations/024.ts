import type { Database } from 'better-sqlite3'

export default function migration(db: Database): void {
  // 1. Plan nodes
  const planCols = (db.pragma('table_info(plan_nodes)') as { name: string }[]).map(c => c.name);
  
  // Rename ai_instructions to ai_user_prompt if exists
  if (planCols.includes('ai_instructions') && !planCols.includes('ai_user_prompt')) {
    db.exec('ALTER TABLE plan_nodes RENAME COLUMN ai_instructions TO ai_user_prompt');
    console.log('Renamed ai_instructions to ai_user_prompt in plan_nodes');
  }
  
  // Add ai_system_prompt column if missing
  if (!planCols.includes('ai_system_prompt')) {
    db.exec('ALTER TABLE plan_nodes ADD COLUMN ai_system_prompt TEXT NULL');
    console.log('Added ai_system_prompt column to plan_nodes');
  }

  // 2. Lore nodes
  const loreCols = (db.pragma('table_info(lore_nodes)') as { name: string }[]).map(c => c.name);
  
  // Rename ai_instructions to ai_user_prompt if exists
  if (loreCols.includes('ai_instructions') && !loreCols.includes('ai_user_prompt')) {
    db.exec('ALTER TABLE lore_nodes RENAME COLUMN ai_instructions TO ai_user_prompt');
    console.log('Renamed ai_instructions to ai_user_prompt in lore_nodes');
  }
  
  // Add ai_system_prompt column if missing
  if (!loreCols.includes('ai_system_prompt')) {
    db.exec('ALTER TABLE lore_nodes ADD COLUMN ai_system_prompt TEXT NULL');
    console.log('Added ai_system_prompt column to lore_nodes');
  }
}