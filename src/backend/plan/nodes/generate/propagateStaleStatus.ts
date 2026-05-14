import type { PlanNodeRow } from "../../../../shared/plan-graph.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan-node-repository.js"

/**
 * Before a regeneration sweep starts, propagate "stale" status through the
 * graph so the topological scheduler doesn't accidentally consider a
 * GENERATED downstream node ready to run while one of its (transitively)
 * upstream inputs still needs to regenerate.
 *
 * Two rules, applied repeatedly to fixpoint:
 *   1. Forward via input edges — if any upstream node has a stale status,
 *      mark this GENERATED node OUTDATED.
 *   2. Bottom-up via parent_id — if any descendant of a container is stale,
 *      mark the GENERATED container OUTDATED (so the scheduler enters it
 *      and its regenerate method handles the inner sub-tree).
 *
 * Stale-source set:
 *   - always: ERROR, OUTDATED, EMPTY
 *   - + MANUAL  when `regenerateManual` is on (user wants their edits redone)
 *   - + GENERATED when `regenerateGenerated` is on (user wants a full re-run)
 *
 * Targets we ever flip: GENERATED → OUTDATED. We never demote MANUAL
 * (user-authoritative) nor disturb in-flight (GENERATING) / already-stale
 * statuses.
 */
export interface PropagateOptions {
  regenerateManual: boolean
  regenerateGenerated: boolean
}

export function propagateStaleStatus(
  options: PropagateOptions = { regenerateManual: false, regenerateGenerated: false },
): {
  markedNodeIds: number[]
} {
  const staleStatuses = new Set<PlanNodeRow["status"]>(["OUTDATED", "ERROR", "EMPTY"])
  if (options.regenerateManual) staleStatuses.add("MANUAL")
  if (options.regenerateGenerated) staleStatuses.add("GENERATED")

  const nodeRepo = new PlanNodeRepository()
  const edgeRepo = new PlanEdgeRepository()

  const allNodes = nodeRepo.findAll()
  const byId = new Map<number, PlanNodeRow>(allNodes.map((n) => [n.id, n]))

  const downstream = new Map<number, number[]>()
  for (const e of edgeRepo.findAll()) {
    const list = downstream.get(e.from_node_id) ?? []
    list.push(e.to_node_id)
    downstream.set(e.from_node_id, list)
  }

  const childrenByParent = new Map<number, PlanNodeRow[]>()
  for (const n of allNodes) {
    if (n.parent_id != null) {
      const list = childrenByParent.get(n.parent_id) ?? []
      list.push(n)
      childrenByParent.set(n.parent_id, list)
    }
  }

  const marked: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const node of allNodes) {
      if (node.status !== "GENERATED") continue

      const upstreamStale = (() => {
        for (const [fromId, outs] of downstream) {
          if (outs.includes(node.id)) {
            const src = byId.get(fromId)
            if (src && staleStatuses.has(src.status)) return true
          }
        }
        return false
      })()

      const childStale = (childrenByParent.get(node.id) ?? []).some((c) => staleStatuses.has(c.status))

      if (upstreamStale || childStale) {
        nodeRepo.patch(node.id, { status: "OUTDATED" })
        node.status = "OUTDATED"
        marked.push(node.id)
        changed = true
      }
    }
  }
  return { markedNodeIds: marked }
}
