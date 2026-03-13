export interface AiEngineSyncRecord {
  /** ISO-8601 UTC timestamp of last successful sync */
  last_synced_at: string
  /** Remote file ID if the node was uploaded as its own file */
  file_id?: string
  /** True if the content was included in the parent's file, not as a standalone file */
  uploaded_as_parent?: boolean
  /** ISO-8601 UTC timestamp of when content was last modified (updated by PATCH on every content save) */
  content_updated_at?: string
}

/** Which statistic to show per node in the lore tree */
export type LoreStatMode = 'none' | 'words' | 'chars' | 'bytes'

/**
 * Unified lore tree node.
 * - A node with children acts as a folder/section.
 * - A node with content !== null and content.trim().length > 0 has content (acts as an item).
 * - A node can be both (section with its own overview text).
 */
export interface LoreNode {
  id: number
  parent_id: number | null
  name: string
  content: string | null
  word_count: number
  char_count: number
  byte_count: number
  ai_sync_info: Record<string, AiEngineSyncRecord> | null
  position: number
  status: string
  /** 1 = marked for deletion, 0 = active */
  to_be_deleted: number
  created_at: string
  children: LoreNode[]
}

export interface PlanNodeTree {
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
  /** Content before the first improvement started */
  review_base_content: string | null
  /** Last AI improve instruction used */
  last_improve_instruction: string | null
  children: PlanNodeTree[]
}

/** Plan graph node (returned by GET /api/plan/graph) */
export interface PlanGraphNode {
  id: number
  type: 'text' | 'lore' | 'merge'
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

/** Plan graph edge */
export interface PlanGraphEdge {
  id: number
  from_node_id: number
  to_node_id: number
  type: 'instruction' | 'attachment' | 'system_prompt' | 'merge_into'
  position: number
  label: string | null
  template: string | null
}

export interface StoryPart {
  id: number
  plan_node_version_id: number
  version: number
  content: string
  title: string | null
  created_at: string
}

export type ThemePreference = 'auto' | 'obsidian' | 'github'
export type ResolvedTheme = 'obsidian' | 'github'

export interface ProjectData {
  path: string
  layout: unknown | null
  projectTitle: string | null
}

export type LocaleStrings = Record<string, string>
