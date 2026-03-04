/** Event name fired by LoreEditor after a successful content save. */
export const LORE_NODE_SAVED_EVENT = 'lore-node-saved'

export interface LoreNodeSavedDetail {
  id: number
  wordCount: number
  charCount: number
  byteCount: number
}

/** Compute word/char/byte counts for a text string (mirrors backend logic). */
export function computeStats(text: string): { wordCount: number; charCount: number; byteCount: number } {
  const trimmed = text.trim()
  return {
    wordCount: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    charCount: [...text].length,
    byteCount: new TextEncoder().encode(text).length,
  }
}

/** Dispatch a lore-node-saved event on window so other panels can react. */
export function dispatchLoreNodeSaved(detail: LoreNodeSavedDetail): void {
  window.dispatchEvent(new CustomEvent<LoreNodeSavedDetail>(LORE_NODE_SAVED_EVENT, { detail }))
}
