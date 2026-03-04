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
