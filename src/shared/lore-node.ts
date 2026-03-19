export interface LoreNodeRow {
  id: number
  parent_id: number | null
  name: string
  content: string | null
  position: number
  status: string
  to_be_deleted: number
  created_at: string
  word_count: number
  char_count: number
  byte_count: number
  ai_sync_info: string | null
  changes_status: string | null
  review_base_content: string | null
  last_improve_instruction: string | null
  user_prompt: string | null
  system_prompt: string | null
  ai_settings: string | null
}

type LoreNodeInsert = Omit<LoreNodeRow, 'id' | 'created_at'>

export const LoreNodeDefaults : Partial<LoreNodeInsert> = {
  parent_id: null,
  content: null,
  position: 0,
  to_be_deleted: 0,
  user_prompt: null,
  system_prompt: null,
  ai_sync_info: null,
  ai_settings: null,
  word_count: 0,
  char_count: 0,
  byte_count: 0,
  changes_status: null,
  review_base_content: null,
  last_improve_instruction: null,
}

type DefaultLoreNodeKeys = keyof typeof LoreNodeDefaults;
export type LoreNodeCreate = Omit<LoreNodeInsert, DefaultLoreNodeKeys> & Partial<Pick<LoreNodeInsert, DefaultLoreNodeKeys>>;
export type LoreNodeUpdate = Partial<Omit<LoreNodeRow, 'id' | 'created_at'>>
