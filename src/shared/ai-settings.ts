export interface AiSettings {
  model?: string
  webSearch?: string
  includeExistingLore?: boolean
  maxTokens?: number
  /** undefined = not set (no extra limit) */
  maxCompletionTokens?: number
}
