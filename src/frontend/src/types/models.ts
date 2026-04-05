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

export interface ProjectData {
  path: string
  layout?: unknown
  projectTitle: string | null
}

export type LocaleStrings = Record<string, string>
