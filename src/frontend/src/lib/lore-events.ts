/** Event name fired by LoreEditor after a successful content save. */
export const LORE_NODE_SAVED_EVENT = 'lore-node-saved'

export interface LoreNodeSavedDetail {
  id: number
  name?: string
  wordCount?: number
  charCount?: number
  byteCount?: number
}

/** Dispatch a lore-node-saved event on window so other panels can react. */
export function dispatchLoreNodeSaved(detail: LoreNodeSavedDetail): void {
  window.dispatchEvent(new CustomEvent<LoreNodeSavedDetail>(LORE_NODE_SAVED_EVENT, { detail }))
}

/** Event fired by SettingsPanel when the active AI engine changes. */
export const AI_ENGINE_CHANGED_EVENT = 'ai-engine-changed'

/** Dispatch an ai-engine-changed event so LoreSettingsProvider re-fetches current_backend. */
export function dispatchAiEngineChanged(): void {
  window.dispatchEvent(new CustomEvent(AI_ENGINE_CHANGED_EVENT))
}
