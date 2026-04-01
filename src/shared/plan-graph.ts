export const NODE_TYPES = ['text', 'lore', 'merge', 'split', 'for-each', 'for-each-input', 'for-each-output'] as const
export type PlanNodeType = typeof NODE_TYPES[number]

export const PLAN_NODE_STATUSES = ['EMPTY', 'GENERATED', 'MANUAL', 'OUTDATED', 'ERROR'] as const
export type PlanNodeStatus = typeof PLAN_NODE_STATUSES[number]

export const EDGE_TYPES = ['text', 'textArray'] as const
export type PlanEdgeType = typeof EDGE_TYPES[number]

export interface PlanNodeRow {
  id: number
  type: PlanNodeType
  title: string
  parent_id: number | null
  position: number | null
  content: string | null
  ai_user_prompt: string | null
  ai_system_prompt: string | null
  summary: string | null
  ai_sync_info: string | null
  node_type_settings: string | null
  ai_settings: string | null
  x: number
  y: number
  width: number | null
  height: number | null
  word_count: number
  char_count: number
  byte_count: number
  status: PlanNodeStatus
  in_review: 0 | 1
  review_base_content: string | null
  ai_improve_instruction: string | null
  created_at: string
}

type PlanNodeInsert = Omit<PlanNodeRow, 'id' | 'created_at'>

export const PlanNodeRowDefaults : Partial<PlanNodeInsert> = {
  parent_id: null,
  position: null,
  ai_user_prompt: null,
  ai_system_prompt: null,
  summary: null,
  ai_sync_info: null,
  node_type_settings: null,
  ai_settings: null,
  width: null,
  height: null,
  word_count: 0,
  char_count: 0,
  byte_count: 0,
  in_review: 0,
  review_base_content: null,
  ai_improve_instruction: null,
}

type DefaultPlanNodeKeys = keyof typeof PlanNodeRowDefaults;
export type PlanNodeCreate = Omit<PlanNodeInsert, DefaultPlanNodeKeys> & Partial<Pick<PlanNodeInsert, DefaultPlanNodeKeys>>;
export type PlanNodeUpdate = Partial<Omit<PlanNodeRow, 'id' | 'created_at' | 'type'>>

export interface PlanEdgeRow {
  id: number
  from_node_id: number
  to_node_id: number
  type: PlanEdgeType
  position: number
  label: string | null
  template: string | null
}

type PlanEdgeInsert = Omit<PlanEdgeRow, 'id'>

export const PlanEdgeRowDefaults: Partial<PlanEdgeInsert> = {
  type: 'text',
  position: 0,
  label: null,
  template: null,
}

type DefaultPlanEdgeKeys = keyof typeof PlanEdgeRowDefaults
export type PlanEdgeCreate = Omit<PlanEdgeInsert, DefaultPlanEdgeKeys> &
  Partial<Pick<PlanEdgeInsert, DefaultPlanEdgeKeys>>
export type PlanEdgeUpdate = Partial<PlanEdgeInsert>

export interface PlanGraphData {
  nodes: PlanNodeRow[]
  edges: PlanEdgeRow[]
}
