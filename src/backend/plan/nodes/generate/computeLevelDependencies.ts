import type { PlanEdgeRow, PlanNodeRow } from "../../../../shared/plan-graph.js"

/**
 * Builds the dependency graph the scheduler uses to decide processing order
 * for a single level of the plan tree (children of a given `parentId`).
 *
 * Why this isn't just "all edges between siblings": an edge can land on a
 * node inside one of those siblings (a grandchild). The previous scheduler
 * filtered such edges out and treated the sibling as having no upstream,
 * which led to siblings being processed before their cross-boundary input
 * was ready. Concrete failure mode in fiction-arc:
 *
 *   #20 «Цикл первого драфта»            (top-level for-each)
 *     #28 «Полировка прозы (1)»          (inside #20)
 *     #29 «Выход первого драфта»         (for-each-output, inside #20)
 *   #30 «Сборка первого драфта»          (top-level merge)
 *   #31 «Цикл второго драфта»            (top-level for-each)
 *     #34 «Переписывание сцены»          (inside #31)
 *
 *   edge: #30 → #34   (cross-boundary IN)
 *
 * #31 should depend on #30 because something inside #31 reads from #30. The
 * old top-level filter dropped that edge; #31 ran in parallel with #30 and
 * its inner iteration consumed an empty {{Сборка первого драфта}}.
 *
 * Fix: project every edge onto the current level by walking up parent_id
 * until we land on a sibling at this level (or fall off). After projection,
 * internal edges (both endpoints map to the same sibling) are ignored;
 * cross-sibling edges become the dependency.
 */
export interface LevelDependencies {
  /** Direct children of `parentId` — the nodes the scheduler iterates over. */
  nodes: PlanNodeRow[]
  /** For each sibling id: the sibling ids it depends on (incoming). */
  incomingEdges: Map<number, number[]>
  /** For each sibling id: the sibling ids that depend on it (outgoing). */
  outgoingEdges: Map<number, number[]>
}

export function computeLevelDependencies(args: {
  parentId: number | null
  allNodes: PlanNodeRow[]
  allEdges: PlanEdgeRow[]
}): LevelDependencies {
  const { parentId, allNodes, allEdges } = args

  const nodes = allNodes.filter((n) => n.parent_id === parentId)
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const parentOf = new Map<number, number | null>(allNodes.map((n) => [n.id, n.parent_id]))

  function siblingAncestor(id: number): number | null {
    let cur: number | null = id
    // Walk up until we hit a sibling at this level, or fall off the tree.
    while (cur != null) {
      if (nodeIdSet.has(cur)) return cur
      cur = parentOf.get(cur) ?? null
    }
    return null
  }

  const incoming = new Map<number, number[]>()
  const outgoing = new Map<number, number[]>()
  for (const n of nodes) {
    incoming.set(n.id, [])
    outgoing.set(n.id, [])
  }

  for (const edge of allEdges) {
    const fromTop = siblingAncestor(edge.from_node_id)
    const toTop = siblingAncestor(edge.to_node_id)
    if (fromTop == null || toTop == null) continue // edge doesn't touch this level
    if (fromTop === toTop) continue // internal to one sibling, not a level-dep
    const incList = incoming.get(toTop)!
    if (!incList.includes(fromTop)) incList.push(fromTop)
    const outList = outgoing.get(fromTop)!
    if (!outList.includes(toTop)) outList.push(toTop)
  }

  return { nodes, incomingEdges: incoming, outgoingEdges: outgoing }
}
