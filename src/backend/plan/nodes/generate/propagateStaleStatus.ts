import { loopLength } from "../../../../shared/for-each-plan-node.js"
import type { PlanNodeDefinition, PlanNodeStatus } from "../../../../shared/plan-graph.js"
import {
  childPath,
  lastSegment,
  type NodePath,
  parentPath,
  ROOT_PATH,
  truncatePath,
} from "../../../../shared/plan-node-path.js"
import { withDbTransaction } from "../../../db/connection.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { usesInput } from "../input-relevance.js"
import { planNodeEventManager } from "../plan-node-event-manager.js"
import { PlanNodeRepository } from "../plan-node-repository.js"
import { LOOP_TYPES } from "../plan-node-service.js"
import { type PlanNodeStateRecord, PlanNodeStateRepository } from "../plan-node-state-repository.js"
import { hasRegenerationCriteria } from "./regeneration-criteria.js"

/**
 * Node types whose content is a pure function of their inputs — no model call,
 * no randomness. Re-running one over unchanged inputs reproduces its content
 * exactly, emptiness included.
 */
const DETERMINISTIC_TYPES = new Set<PlanNodeDefinition["type"]>([
  "merge",
  "script",
  "format",
  // A loop is EMPTY only when its list is: over the same list it stays empty.
  "for-each",
  "for-each-input",
  "for-each-output",
  "for-each-index",
  "for-each-prev-outputs",
])

export interface PropagateOptions {
  regenerateManual: boolean
  regenerateGenerated: boolean
}

/** One node in one iteration. */
interface Instance {
  node: PlanNodeDefinition
  path: NodePath
  /** Undefined while the node has produced nothing in this iteration: pending work. */
  state: PlanNodeStateRecord | undefined
}

const keyOf = (nodeId: number, path: NodePath) => `${nodeId}@${path}`

/**
 * Before a regeneration sweep starts, propagate "stale" status through the
 * graph so the topological scheduler doesn't consider a GENERATED node ready
 * while something it depends on still has work to do. It works on instances —
 * a node in one iteration — and runs to a fixpoint:
 *
 *   1. Forward via input edges — an instance whose input (read at its path,
 *      and only if its prompt uses it) is stale becomes OUTDATED. A source
 *      outside a loop feeds every iteration of it.
 *   2. A loop has two conditions. It *needs a visit* when a child in one of
 *      its current iterations is stale or has not run there yet: then it is
 *      OUTDATED, so the scheduler enters it. Its *output is stale* when its
 *      output child is, in some iteration — and only that feeds rule 1. A
 *      side node failing inside a loop is not a reason to redo everything
 *      downstream of the loop.
 *   3. A `for-each-prev-outputs` in iteration j reads the loop's output in
 *      iterations 0 … j−1: it is stale when one of them is.
 *
 * Stale sources per rule:
 *   - forward: ERROR, OUTDATED, pending, and EMPTY — but only a *contagious*
 *     EMPTY, see computeContagiousEmpty. A deterministic node fed by settled
 *     inputs re-runs to the same emptiness, so its EMPTY is an answer.
 *   - needs a visit: ERROR, OUTDATED, pending — not EMPTY: a merge of earlier
 *     iterations is legitimately empty in iteration 0.
 *   - + MANUAL  when `regenerateManual` is on (user wants their edits redone)
 *   - + GENERATED when `regenerateGenerated` is on (user wants a full re-run)
 *
 * Only GENERATED instances are ever flipped, to OUTDATED. MANUAL stays the
 * user's; GENERATING, pending and already stale ones are left alone.
 */
export function propagateStaleStatus(
  options: PropagateOptions = { regenerateManual: false, regenerateGenerated: false },
): { marked: { nodeId: number; path: NodePath }[] } {
  const forwardStale = new Set<PlanNodeStatus>(["OUTDATED", "ERROR", "EMPTY"])
  const visitStale = new Set<PlanNodeStatus>(["OUTDATED", "ERROR"])
  if (options.regenerateManual) {
    forwardStale.add("MANUAL")
    visitStale.add("MANUAL")
  }
  if (options.regenerateGenerated) {
    forwardStale.add("GENERATED")
    visitStale.add("GENERATED")
  }

  const definitions = new PlanNodeRepository().findAll()
  const byId = new Map(definitions.map((n) => [n.id, n]))
  const childrenOf = new Map<number | null, PlanNodeDefinition[]>()
  for (const n of definitions) {
    const list = childrenOf.get(n.parent_id) ?? []
    list.push(n)
    childrenOf.set(n.parent_id, list)
  }
  const incoming = new Map<number, number[]>()
  for (const e of new PlanEdgeRepository().findAll()) {
    const list = incoming.get(e.to_node_id) ?? []
    list.push(e.from_node_id)
    incoming.set(e.to_node_id, list)
  }
  const stateRepo = new PlanNodeStateRepository()
  const states = new Map(stateRepo.findAll().map((s) => [keyOf(s.node_id, s.path), s]))
  const stateAt = (nodeId: number, path: NodePath) => states.get(keyOf(nodeId, path))

  const loopsCache = new Map<number, number[]>()
  const loopsAround = (nodeId: number): number[] => {
    let loops = loopsCache.get(nodeId)
    if (loops) return loops
    loops = []
    for (let p = byId.get(nodeId)?.parent_id ?? null; p !== null; p = byId.get(p)?.parent_id ?? null) {
      const parent = byId.get(p)
      if (!parent) break
      if (LOOP_TYPES.has(parent.type)) loops.unshift(parent.id)
    }
    loopsCache.set(nodeId, loops)
    return loops
  }

  /** The iterations of `loop` at `path` it currently has. */
  const iterationsOf = (loop: PlanNodeDefinition, path: NodePath): NodePath[] =>
    Array.from({ length: loopLength(stateAt(loop.id, path)?.content) }, (_, i) => childPath(path, loop.id, i))

  // Every instance that should exist: outside loops at '', inside a loop in
  // each of its current iterations. Rows left under vanished keys are not
  // instances; the loop's next run deletes them.
  const instances: Instance[] = []
  const collect = (parentId: number | null, paths: NodePath[]) => {
    for (const node of childrenOf.get(parentId) ?? []) {
      for (const path of paths) instances.push({ node, path, state: stateAt(node.id, path) })
      collect(node.id, LOOP_TYPES.has(node.type) ? paths.flatMap((p) => iterationsOf(node, p)) : paths)
    }
  }
  collect(null, [ROOT_PATH])

  const criteria = new Map<number, boolean>()
  const regenerable = (node: PlanNodeDefinition): boolean => {
    let result = criteria.get(node.id)
    if (result === undefined) {
      result = hasRegenerationCriteria(node)
      criteria.set(node.id, result)
    }
    return result
  }
  // The same relevance rule as the cascade: a stale input the prompt never
  // reads cannot make the node stale. Settings do not change here, so memoize.
  const relevance = new Map<string, boolean>()
  const reads = (consumer: PlanNodeDefinition, source: PlanNodeDefinition): boolean => {
    const key = `${consumer.id}:${source.id}`
    let result = relevance.get(key)
    if (result === undefined) {
      result = usesInput(consumer, source)
      relevance.set(key, result)
    }
    return result
  }

  /**
   * Whether the instance is work still to be done, for a status in `stale`. A
   * node with nothing to generate from — a synopsis the user typed — is never
   * redone, whatever its status says, so its content is final.
   */
  const pending = (node: PlanNodeDefinition, state: PlanNodeStateRecord | undefined, stale: Set<PlanNodeStatus>) =>
    regenerable(node) && (state === undefined || stale.has(state.status))

  const outputOf = (loop: PlanNodeDefinition) =>
    (childrenOf.get(loop.id) ?? []).find((child) => child.type === "for-each-output")

  /** Whether what `node` outputs at `path` is going to change, as a reader sees it. */
  const outputStale = (node: PlanNodeDefinition, path: NodePath, contagious: Set<string>): boolean => {
    if (LOOP_TYPES.has(node.type)) {
      // A loop's output is its output child's, iteration by iteration. A loop
      // that never ran here has no known output at all.
      if (stateAt(node.id, path) === undefined) return true
      const output = outputOf(node)
      return !!output && iterationsOf(node, path).some((p) => outputStale(output, p, contagious))
    }
    const state = stateAt(node.id, path)
    if (state?.status === "EMPTY") return contagious.has(keyOf(node.id, path))
    return pending(node, state, forwardStale)
  }

  /** Whether an input of the instance, read at its path, is stale. */
  const inputStale = ({ node, path }: Instance, contagious: Set<string>): boolean => {
    const sourceIds = incoming.get(node.id) ?? []
    const consumerLoops = loopsAround(node.id)
    for (const sourceId of sourceIds) {
      const source = byId.get(sourceId)
      if (!source || !reads(node, source)) continue
      const sourceLoops = loopsAround(sourceId)
      // A source in a loop the reader is not in has no iteration to read; the
      // engine refuses such an edge when it resolves it.
      if (sourceLoops.some((loop, i) => consumerLoops[i] !== loop)) continue
      if (outputStale(source, truncatePath(path, sourceLoops.length), contagious)) return true
    }
    const segment = lastSegment(path)
    if (node.type === "for-each-prev-outputs" && segment && segment.containerId === node.parent_id) {
      const loop = byId.get(segment.containerId)
      const output = loop && outputOf(loop)
      for (let k = 0; output && k < Number(segment.key); k++) {
        if (outputStale(output, childPath(parentPath(path), segment.containerId, k), contagious)) return true
      }
    }
    return false
  }

  /**
   * Which EMPTY instances actually mean "work is pending". For a deterministic
   * node fed by settled inputs, EMPTY is a finished answer: re-running yields
   * the same nothing. For a generative node it is unfinished — an empty answer
   * today may be a full one tomorrow — so it stays contagious. Conflating the
   * two dragged a whole loop back through the model: a merge of earlier
   * iterations is legitimately EMPTY in iteration 0.
   */
  const computeContagiousEmpty = (): Set<string> => {
    const contagious = new Set<string>()
    const empty = instances.filter((i) => i.state?.status === "EMPTY")
    for (const i of empty) {
      if (!DETERMINISTIC_TYPES.has(i.node.type) && regenerable(i.node)) contagious.add(keyOf(i.node.id, i.path))
    }
    let grew = true
    while (grew) {
      grew = false
      for (const i of empty) {
        const key = keyOf(i.node.id, i.path)
        if (contagious.has(key) || !inputStale(i, contagious)) continue
        contagious.add(key)
        grew = true
      }
    }
    return contagious
  }

  /** Whether a loop instance has a child, in one of its current iterations, still to run. */
  const needsVisit = ({ node, path }: Instance): boolean => {
    if (!LOOP_TYPES.has(node.type)) return false
    const children = childrenOf.get(node.id) ?? []
    return iterationsOf(node, path).some((p) => children.some((c) => pending(c, stateAt(c.id, p), visitStale)))
  }

  const marked: Instance[] = []
  let changed = true
  while (changed) {
    changed = false
    const contagious = computeContagiousEmpty()
    for (const instance of instances) {
      if (instance.state?.status !== "GENERATED") continue
      if (!inputStale(instance, contagious) && !needsVisit(instance)) continue
      const demoted: PlanNodeStateRecord = { ...instance.state, status: "OUTDATED" }
      instance.state = demoted
      states.set(keyOf(instance.node.id, instance.path), demoted)
      marked.push(instance)
      changed = true
    }
  }

  withDbTransaction(() => {
    for (const { node, path } of marked) stateRepo.upsert(node.id, path, { status: "OUTDATED" })
  })
  for (const nodeId of new Set(marked.map((i) => i.node.id))) {
    planNodeEventManager.emitUpdate(nodeId, "stale input or child, before a run")
  }
  return { marked: marked.map(({ node, path }) => ({ nodeId: node.id, path })) }
}
