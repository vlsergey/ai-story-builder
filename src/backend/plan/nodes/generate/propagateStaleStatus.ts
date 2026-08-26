import type { PlanNodeRow } from "../../../../shared/plan-graph.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan-node-repository.js"

/**
 * Node types whose content is a pure function of their inputs — no model call,
 * no randomness. Re-running one over unchanged inputs reproduces its content
 * exactly, emptiness included.
 */
const DETERMINISTIC_TYPES = new Set<PlanNodeRow["type"]>([
  "merge",
  "script",
  "format",
  "for-each-input",
  "for-each-output",
  "for-each-index",
  "for-each-prev-outputs",
])

/**
 * Which EMPTY nodes actually mean "work is pending".
 *
 * EMPTY says "has no content" — on its own it does not say whether that is a
 * finished answer or an unfinished one. For a deterministic node fed by
 * settled inputs it is finished: re-running yields the same nothing, so every
 * reader downstream is still fresh. For a generative node it is unfinished —
 * an empty answer today may be a full one tomorrow — so it stays contagious.
 *
 * Conflating the two is what dragged a whole for-each loop back through the
 * model: one merge node aggregating previous iterations is legitimately EMPTY
 * on iteration 0, it fed six siblings, they were pre-marked OUTDATED, that
 * promoted the container bottom-up, and an hour of prose regenerated for
 * nothing. Bottom-up propagation already carved out this case; forward
 * propagation did not.
 */
function computeContagiousEmpty(
  allNodes: PlanNodeRow[],
  incoming: Map<number, number[]>,
  byId: Map<number, PlanNodeRow>,
  forwardStale: Set<PlanNodeRow["status"]>,
): Set<number> {
  const contagious = new Set<number>()
  for (const n of allNodes) {
    if (n.status === "EMPTY" && !DETERMINISTIC_TYPES.has(n.type)) contagious.add(n.id)
  }
  let grew = true
  while (grew) {
    grew = false
    for (const n of allNodes) {
      if (n.status !== "EMPTY" || contagious.has(n.id)) continue
      const pendingSource = (incoming.get(n.id) ?? []).some((srcId) => {
        const src = byId.get(srcId)
        if (!src) return false
        return src.status === "EMPTY" ? contagious.has(src.id) : forwardStale.has(src.status)
      })
      if (pendingSource) {
        contagious.add(n.id)
        grew = true
      }
    }
  }
  return contagious
}

export interface PropagateOptions {
  regenerateManual: boolean
  regenerateGenerated: boolean
}

/**
 * Before a regeneration sweep starts, propagate "stale" status through the
 * graph so the topological scheduler doesn't accidentally consider a
 * GENERATED downstream node ready to run while one of its (transitively)
 * upstream inputs still needs to regenerate.
 *
 * Three rules, applied repeatedly to fixpoint:
 *   1. Forward via input edges — if any upstream node has a stale status,
 *      mark this GENERATED node OUTDATED.
 *   2. Bottom-up via parent_id — if any descendant of a container is stale,
 *      mark the GENERATED container OUTDATED (so the scheduler enters it
 *      and its regenerate method handles the inner sub-tree).
 *   3. Top-down for for-each-input — these helper nodes are populated by
 *      their parent for-each container, not by edges or self-regeneration,
 *      so neither rule 1 nor rule 2 ever fires. If the container is stale,
 *      the mounted iteration's input row inherits the stale status — without
 *      that the row sits GENERATED with the previous iteration's content
 *      and summary, blocks summary regen, and confuses the UI.
 *
 * Stale-source set per rule:
 *   - forward: ERROR, OUTDATED, and EMPTY — but only a *contagious* EMPTY,
 *     see computeContagiousEmpty. A deterministic node fed by settled inputs
 *     re-runs to the same emptiness, so its EMPTY is an answer, not a debt.
 *   - bottom-up: ERROR, OUTDATED only  (EMPTY descendants do NOT propagate
 *     to their container — for-each-internal merge nodes like «Сборка
 *     предыдущих сцен» are legitimately EMPTY on iter 0, and that is not a
 *     sign of pending work)
 *   - top-down (for-each-input): ERROR, OUTDATED only — same rationale as
 *     bottom-up; an EMPTY container is not pending work
 *   - + MANUAL  when `regenerateManual` is on (user wants their edits redone)
 *   - + GENERATED when `regenerateGenerated` is on (user wants a full re-run)
 *
 * Targets we ever flip: GENERATED → OUTDATED. We never demote MANUAL
 * (user-authoritative) nor disturb in-flight (GENERATING) / already-stale
 * statuses.
 */
export function propagateStaleStatus(
  options: PropagateOptions = { regenerateManual: false, regenerateGenerated: false },
): {
  markedNodeIds: number[]
} {
  const forwardStale = new Set<PlanNodeRow["status"]>(["OUTDATED", "ERROR", "EMPTY"])
  const bottomUpStale = new Set<PlanNodeRow["status"]>(["OUTDATED", "ERROR"])
  // top-down mirrors bottom-up's "real work pending" set — EMPTY container
  // does not warrant demoting the input row.
  const topDownStale = new Set<PlanNodeRow["status"]>(["OUTDATED", "ERROR"])
  if (options.regenerateManual) {
    forwardStale.add("MANUAL")
    bottomUpStale.add("MANUAL")
    topDownStale.add("MANUAL")
  }
  if (options.regenerateGenerated) {
    forwardStale.add("GENERATED")
    bottomUpStale.add("GENERATED")
    topDownStale.add("GENERATED")
  }

  const nodeRepo = new PlanNodeRepository()
  const edgeRepo = new PlanEdgeRepository()

  const allNodes = nodeRepo.findAll()
  const byId = new Map<number, PlanNodeRow>(allNodes.map((n) => [n.id, n]))

  const incoming = new Map<number, number[]>()
  for (const e of edgeRepo.findAll()) {
    const list = incoming.get(e.to_node_id) ?? []
    list.push(e.from_node_id)
    incoming.set(e.to_node_id, list)
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
    const contagiousEmpty = computeContagiousEmpty(allNodes, incoming, byId, forwardStale)
    for (const node of allNodes) {
      if (node.status !== "GENERATED") continue

      const upstreamStale = (incoming.get(node.id) ?? []).some((fromId) => {
        const src = byId.get(fromId)
        if (!src) return false
        return src.status === "EMPTY" ? contagiousEmpty.has(src.id) : forwardStale.has(src.status)
      })

      const childStale = (childrenByParent.get(node.id) ?? []).some((c) => bottomUpStale.has(c.status))

      const parentStale = (() => {
        if (node.type !== "for-each-input") return false
        if (node.parent_id == null) return false
        const parent = byId.get(node.parent_id)
        return parent != null && topDownStale.has(parent.status)
      })()

      if (upstreamStale || childStale || parentStale) {
        nodeRepo.patch(node.id, { status: "OUTDATED" })
        node.status = "OUTDATED"
        marked.push(node.id)
        changed = true
      }
    }
  }
  return { markedNodeIds: marked }
}
