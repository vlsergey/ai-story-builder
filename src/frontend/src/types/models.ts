export interface AiEngineSyncRecord {
  /** ISO-8601 UTC timestamp of last successful sync */
  last_synced_at: string
  /** Remote file ID if the node was uploaded as its own file */
  file_id?: string
  /** True if the content was included in the parent's file, not as a standalone file */
  uploaded_as_parent?: boolean
}

/** Which statistic to show per node in the lore tree */
export type LoreStatMode = 'none' | 'words' | 'chars' | 'bytes'

/**
 * Unified lore tree node.
 * - A node with children acts as a folder/section.
 * - A node with latest_version_status !== null has content (acts as an item).
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
  /** ISO-8601 UTC timestamp of when content was last saved; null if never saved */
  content_updated_at: string | null
  position: number
  status: string
  /** 1 = marked for deletion, 0 = active */
  to_be_deleted: number
  /** Status of the latest lore_version, null if no versions exist */
  latest_version_status: string | null
  created_at: string
  children: LoreNode[]
}

export interface LoreVersion {
  id: number
  lore_node_id: number
  version: number
  content: string
  status: string
  created_at: string
}

export interface PlanNodeTree {
  id: number
  parent_id: number | null
  title: string
  content: string | null
  position: number
  created_at: string
  children: PlanNodeTree[]
}

export interface PlanNodeVersion {
  id: number
  plan_node_id: number
  version: number
  instruction: string
  result: string | null
  status: string
  created_at: string
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
