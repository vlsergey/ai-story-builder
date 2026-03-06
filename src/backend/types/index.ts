// Database row types matching the schema defined in db/migrations.ts

export interface LoreNodeRow {
  id: number
  parent_id: number | null
  name: string
  content: string | null
  word_count: number
  char_count: number
  byte_count: number
  ai_sync_info: string | null
  position: number
  status: string
  to_be_deleted: number
  created_at: string
  /** NULL | 'review' — current review workflow state */
  changes_status: string | null
  /** Content before the first improvement started; set once when review begins, cleared on accept */
  review_base_content: string | null
  /** Last AI improve instruction used; stored for restoring review state on reopen */
  last_improve_instruction: string | null
  /** Last generate prompt (mode A); stored to restore the textarea on reopen */
  last_generate_prompt: string | null
}

export interface PlanNodeRow {
  id: number
  parent_id: number | null
  title: string
  content: string | null
  position: number
  created_at: string
  word_count: number
  char_count: number
  byte_count: number
  /** NULL | 'review' — current review workflow state */
  changes_status: string | null
  /** Content before the first improvement started; set once when review begins, cleared on accept */
  review_base_content: string | null
  /** Last AI improve instruction used; stored for restoring review state on reopen */
  last_improve_instruction: string | null
  /** Last generate prompt (mode A); stored to restore the textarea on reopen */
  last_generate_prompt: string | null
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

/** Full lore tree node (returned by GET /lore/tree).
 *  ai_sync_info is delivered as a parsed object (not raw JSON string). */
export interface LoreTreeNode extends Omit<LoreNodeRow, 'ai_sync_info'> {
  ai_sync_info: Record<string, AiEngineSyncRecord> | null
  children: LoreTreeNode[]
}

export interface AiEngineSyncRecord {
  /** ISO-8601 UTC timestamp of last successful sync */
  last_synced_at: string
  /** Remote file ID if the node was uploaded as its own file */
  file_id?: string
  /** True if the content was included in the parent's file, not as a standalone file */
  uploaded_as_parent?: boolean
  /** ISO-8601 UTC timestamp of when content was last modified (set by PATCH on every content save) */
  content_updated_at?: string
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
  /** Last successfully opened project path — restored on backend restart. */
  lastOpenedPath?: string
}
