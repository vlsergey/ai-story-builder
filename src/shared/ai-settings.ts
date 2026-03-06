export interface AiSettings {
  model?: string
  webSearch?: string
  includeExistingLore?: boolean
  maxTokens?: number
  /** undefined = not set (no extra limit) */
  maxCompletionTokens?: number
  /** undefined = no minimum; only used by plan generation */
  minWords?: number
}
