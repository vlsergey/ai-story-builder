export interface LoreFolderNode {
  id: number
  parent_id: number | null
  name: string
  created_at: string
  children: LoreFolderNode[]
}

export interface LoreItem {
  id: number
  folder_id: number
  slug: string
  title: string | null
  created_at: string
}

export interface LoreVersion {
  id: number
  lore_item_id: number
  version: number
  content: string
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
