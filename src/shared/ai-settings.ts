export interface AiSettings {
  model?: string
  // webSearch removed from base – moved to engine-specific settings
  includeExistingLore?: boolean
  maxTokens?: number
  /** undefined = not set (no extra limit) */
  maxCompletionTokens?: number
  /** Web search setting (engine‑specific). */
  webSearch?: string
}
