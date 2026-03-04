// Database row types matching the schema defined in db/migrations.ts

export interface LoreNodeRow {
  id: number
  parent_id: number | null
  name: string
  content: string | null
  position: number
  status: string
  to_be_deleted: number
  created_at: string
}

export interface LoreVersionRow {
  id: number
  lore_node_id: number
  version: number
  content: string
  status: string
  created_at: string
}

export interface PlanNodeRow {
  id: number
  parent_id: number | null
  title: string
  content: string | null
  position: number
  created_at: string
}

export interface PlanNodeVersionRow {
  id: number
  plan_node_id: number
  version: number
  instruction: string
  result: string | null
  status: string
  parent_version_id: number | null
  is_obsolete: boolean
  created_at: string
}

export interface StoryPartRow {
  id: number
  plan_node_version_id: number
  version: number
  content: string
  status: string
  parent_version_id: number | null
  is_obsolete: boolean
  created_at: string
}

export interface CardDefinitionRow {
  id: number
  name: string
  definition: string
  created_at: string
}

export interface CardValueRow {
  id: number
  card_definition_id: number
  story_part_id: number
  version: number
  values: string
  parent_version_id: number | null
  is_obsolete: boolean
  created_at: string
}

export interface AiCallRow {
  id: number
  backend: string
  model: string
  request_type: string | null
  prompt: string | null
  response_summary: string | null
  tokens_input: number | null
  tokens_output: number | null
  cost: number | null
  related_story_part_id: number | null
  created_at: string
}

export interface SettingRow {
  key: string
  value: string
}

// Composite / derived types

/** Full lore tree node (returned by GET /lore/tree) */
export interface LoreTreeNode extends LoreNodeRow {
  /** Status of the latest lore_version, or null if no versions exist */
  latest_version_status: string | null
  children: LoreTreeNode[]
}

export interface PlanNodeTree extends PlanNodeRow {
  children: PlanNodeTree[]
}

export interface ProjectInitialData {
  layout: unknown | null
  projectTitle: string | null
}

export interface AppSettings {
  recent: string[]
}
