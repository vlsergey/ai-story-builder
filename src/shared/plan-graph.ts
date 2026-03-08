export type PlanNodeType = 'text' | 'lore'
export type PlanEdgeType = 'instruction' | 'attachment' | 'system_prompt'

export interface PlanNodeRow {
  id: number
  type: PlanNodeType
  title: string
  content: string | null
  user_prompt: string | null
  system_prompt: string | null
  summary: string | null
  auto_summary: number
  ai_sync_info: string | null
  x: number
  y: number
  word_count: number
  char_count: number
  byte_count: number
  changes_status: string | null
  review_base_content: string | null
  last_improve_instruction: string | null
  created_at: string
}

export interface PlanEdgeRow {
  id: number
  from_node_id: number
  to_node_id: number
  type: PlanEdgeType
  position: number
  label: string | null
  template: string | null
}

export interface PlanGraphData {
  nodes: PlanNodeRow[]
  edges: PlanEdgeRow[]
}
