/**
 * Sorts items so that parents always appear before their children.
 * Uses memoization to avoid redundant depth calculations.
 */
export function sortByHierarchy<T>(
  items: T[],
  getId: (item: T) => string | number,
  getParentId: (item: T) => string | number | null | undefined,
): T[] {
  if (items === undefined || items === null) return []

  const depthMap = new Map<string | number, number>()
  const visited = new Set<string | number>()

  /**
   * Recursively calculates the depth of a node.
   * Root nodes have depth 0.
   */
  const getDepth = (item: T): number => {
    const id = getId(item)

    if (depthMap.has(id)) return depthMap.get(id)!

    // Circular dependency protection
    if (visited.has(id)) return 0
    visited.add(id)

    const parentId = getParentId(item)
    if (!parentId) {
      depthMap.set(id, 0)
      return 0
    }

    const parent = items.find((i) => getId(i) === parentId)
    // If parent is not found, treat this node as a root (depth 0)
    const depth = parent ? 1 + getDepth(parent) : 0

    depthMap.set(id, depth)
    return depth
  }

  // Pre-calculate depths for all items
  items.forEach((item) => {
    getDepth(item)
  })

  // Sort: lower depth (parents) comes first
  return [...items].sort((a, b) => {
    const depthA = depthMap.get(getId(a)) ?? 0
    const depthB = depthMap.get(getId(b)) ?? 0
    return depthA - depthB
  })
}
