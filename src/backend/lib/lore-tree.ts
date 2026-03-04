/**
 * Lore tree collapsing utilities for AI file upload.
 *
 * When an AI engine supports file upload + attachment but has a per-request file limit,
 * the lore tree is collapsed to at most `maxFiles` files by merging each level-2 subtree
 * (direct child of root + all its descendants) into a single markdown document.
 */

export interface LoreNodeForCollapse {
  id: number
  parent_id: number | null
  name: string
  content: string | null
  word_count: number
  to_be_deleted: number
}

export interface CollapsedGroup {
  /** The level-2 node ID (direct child of root). */
  level2NodeId: number
  /** The level-2 node name. */
  level2NodeName: string
  /**
   * Concatenated markdown content for the group.
   * Each included node is separated by a horizontal rule and preceded by a heading.
   * Empty string when no active, non-empty nodes exist in the subtree.
   */
  content: string
  /** All node IDs in this subtree (level-2 + all descendants), regardless of deletion status. */
  allNodeIds: number[]
  /** True if the collapsed content is non-empty. */
  hasContent: boolean
}

export type CollapseLoreTreeResult = CollapsedGroup[] | { error: string }

/**
 * Collapses the lore tree into level-2 groups for AI upload.
 *
 * Each direct child of root becomes one group. All its descendants are merged
 * in recursively, with markdown headings added for separation (level-2 → `#`,
 * level-3 → `##`, etc.).
 *
 * Nodes with `to_be_deleted=1` or `word_count=0` are excluded from the content
 * but their IDs are still present in `allNodeIds` so callers can clean up
 * existing sync metadata.
 *
 * @param rows   All lore node rows.
 * @param maxFiles  Maximum number of groups allowed. Returns `{ error }` if exceeded.
 */
export function collapseLoreTree(
  rows: LoreNodeForCollapse[],
  maxFiles: number,
): CollapseLoreTreeResult {
  const idToRow = new Map(rows.map(r => [r.id, r]))
  const childrenMap = new Map<number, number[]>()

  for (const row of rows) {
    if (row.parent_id !== null) {
      if (!childrenMap.has(row.parent_id)) childrenMap.set(row.parent_id, [])
      childrenMap.get(row.parent_id)!.push(row.id)
    }
  }

  // Find the root node (parent_id IS NULL)
  const rootRow = rows.find(r => r.parent_id === null)
  if (!rootRow) return []

  // Level-2 = direct children of root
  const level2Ids = childrenMap.get(rootRow.id) ?? []

  if (level2Ids.length > maxFiles) {
    return {
      error:
        `Too many top-level lore categories (${level2Ids.length}). ` +
        `Maximum is ${maxFiles} for this AI engine. ` +
        `Please reduce the number of top-level categories.`,
    }
  }

  const groups: CollapsedGroup[] = []

  for (const l2Id of level2Ids) {
    const l2Row = idToRow.get(l2Id)!
    const allNodeIds: number[] = []
    const contentParts: string[] = []

    function collectNode(nodeId: number, depth: number): void {
      const row = idToRow.get(nodeId)!
      allNodeIds.push(nodeId)

      if (row.to_be_deleted === 0 && row.word_count > 0 && row.content) {
        const heading = '#'.repeat(depth)
        contentParts.push(`${heading} ${row.name}\n\n${row.content}`)
      }

      for (const childId of childrenMap.get(nodeId) ?? []) {
        collectNode(childId, depth + 1)
      }
    }

    collectNode(l2Id, 1)

    const content = contentParts.join('\n\n---\n\n')
    groups.push({
      level2NodeId: l2Id,
      level2NodeName: l2Row.name,
      content,
      allNodeIds,
      hasContent: content.length > 0,
    })
  }

  return groups
}
