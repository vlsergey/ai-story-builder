import { loopLength } from "./for-each-plan-node.js"
import { parallelIterationKeys } from "./parallel-plan-node.js"
import type { PlanNodeType } from "./plan-node-types.js"

/** Node types that hold iterations: their children have one state per iteration. */
export const LOOP_TYPES: ReadonlySet<PlanNodeType> = new Set<PlanNodeType>(["for-each", "parallel"])

/**
 * The iterations a loop has, as the keys its children's paths use, from the
 * loop's own content: `0 … n−1` for a for-each, element hashes for a
 * parallel loop. Any other key names no iteration.
 */
export function iterationKeys(type: PlanNodeType, content: string | null | undefined): string[] {
  switch (type) {
    case "for-each":
      return Array.from({ length: loopLength(content) }, (_, i) => String(i))
    case "parallel":
      return parallelIterationKeys(content)
    default:
      return []
  }
}

/**
 * The loops a node sits in, outermost first, walking up through `nodeOf`.
 * Stops at a node already seen: a parent chain that loops back on itself is
 * broken data, and must not hang whoever asks.
 */
export function loopsAround(
  nodeId: number,
  nodeOf: (id: number) => { parent_id: number | null; type: PlanNodeType } | undefined,
): number[] {
  const loops: number[] = []
  const seen = new Set<number>([nodeId])
  for (let p = nodeOf(nodeId)?.parent_id ?? null; p !== null && !seen.has(p); p = nodeOf(p)?.parent_id ?? null) {
    seen.add(p)
    const parent = nodeOf(p)
    if (!parent) break
    if (LOOP_TYPES.has(parent.type)) loops.unshift(p)
  }
  return loops
}
