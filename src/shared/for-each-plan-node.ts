

export interface NodeOverride {
  content: string | null | undefined,
  summary: string | null | undefined,
  word_count: number | null | undefined,
  char_count: number | null | undefined,
  byte_count: number | null | undefined,
  status: string | null | undefined,
}

export interface ForEachNodeContent {
  currentIndex?: number,
  /** May not be the same as length of overrides */
  length?: number,
  overrides?: Record<string, NodeOverride>[],
}
