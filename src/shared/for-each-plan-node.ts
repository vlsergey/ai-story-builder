export interface NodeOverride {
  content: string | null | undefined
  summary: string | null | undefined
  word_count: number | null | undefined
  char_count: number | null | undefined
  byte_count: number | null | undefined
  status: string | null | undefined
}

export interface ForEachNodeContent {
  currentIndex?: number
  /** May not be the same as length of overrides */
  length?: number
  /**
   * Per-iteration snapshot of for-each children, keyed by child node id.
   *
   * A populated `overrides[i]` is expected to contain an entry for EVERY child
   * of the for-each (internal nodes: for-each-input/output/index/prev-outputs
   * AND user-defined children). Snapshots are written by `changeForEachNodePage`
   * via `collectForEachNodeIterationContentFromChildren`, which scans all
   * direct children indiscriminately.
   *
   * A freshly-seeded `overrides[i]` (e.g. produced by `onInputContentChange`
   * before any iteration has been visited) may legitimately be partial — only
   * the for-each-input row is known at that point. `applyForEachNodeIterationToChildren`
   * treats any child missing from the map as "reset to empty + OUTDATED" so the
   * regen scheduler picks it up.
   */
  overrides?: Record<string, NodeOverride>[]
}
