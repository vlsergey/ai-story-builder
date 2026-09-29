import { iterationKeys, LOOP_TYPES } from "../../../../shared/loop-iterations.js"
import type { PlanNodeDefinition, PlanNodeRow } from "../../../../shared/plan-graph.js"
import { childPath, lastSegment, type NodePath, parentPath, ROOT_PATH } from "../../../../shared/plan-node-path.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import type { OpenedLoop, PlanNodeService } from "../plan-node-service.js"
import { computeLevelDependencies, type LevelDependencies } from "./computeLevelDependencies.js"
import { hasRegenerationCriteria } from "./regeneration-criteria.js"

/** A unit of a run — a node in one iteration — as the run names it. */
export const unitKey = (nodeId: number, path: NodePath) => `${nodeId}@${path}`

const pathOfKey = (key: string) => key.slice(key.indexOf("@") + 1)

/** What a run has done with its units, beyond what their rows say. */
export interface RunBook {
  /** Units done in this run: run, skipped, or — a loop — closed. */
  done: Set<string>
  /** Units running now. */
  running: Set<string>
  /** Loops opened in this run and not closed yet. */
  opened: Map<string, OpenedLoop>
  /**
   * Loops that must open again whatever their own status says: something
   * inside them was demoted after they were done. Cleared as they open.
   */
  revisit: Set<string>
}

/** Where a run works: the whole graph, or one loop at one path and everything that runs inside it. */
export type RunScope = { loop: { nodeId: number; path: NodePath } } | null

export interface Schedule {
  /**
   * Units that may start now, in the order of the graph: depth first, a
   * loop's earlier iterations before its later ones. Each still needs the
   * run's decision: run it, or skip it.
   */
  ready: PlanNodeRow[]
  /** Opened loops whose iterations are all done: to be closed. */
  closable: PlanNodeRow[]
  /** Opened loops, and how far their iterations have got. */
  loops: LoopProgress[]
  /** Units in the run's reach that are not done yet: waiting, ready or running. */
  pending: PlanNodeRow[]
}

export interface LoopProgress {
  row: PlanNodeRow
  total: number
  done: number
  /** The earliest iteration not done yet. */
  current: string
}

/**
 * What a run can do next, from the graph as it stands. A unit may start once
 * every source it reads at its level — at its own path — is done, and the
 * loops around it are open with their sources done: an input from outside a
 * loop counts as the loop's source (see computeLevelDependencies). A
 * `for-each-prev-outputs` also waits for its loop's output in every iteration
 * before its own; nothing else ties one iteration to another, so iterations
 * run side by side.
 *
 * A unit done earlier in the run that a cascade has since demoted is not done
 * any more: the book forgets it, and it runs again once its sources are done.
 * So does a closed loop with a demoted unit inside, since the cascade demotes
 * readers, never the loops around them.
 */
export function schedule(service: PlanNodeService, book: RunBook, scope: RunScope = null): Schedule {
  const definitions = service.repo.findAll()
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  const edges = new PlanEdgeRepository().findAll()

  const levels = new Map<number | null, LevelDependencies<PlanNodeDefinition>>()
  const levelOf = (parentId: number | null) => {
    let level = levels.get(parentId)
    if (!level) {
      level = computeLevelDependencies({ parentId, allNodes: definitions, allEdges: edges })
      levels.set(parentId, level)
    }
    return level
  }

  const rowsByPath = new Map<NodePath, Map<number, PlanNodeRow>>()
  const rowAt = (nodeId: number, path: NodePath): PlanNodeRow | undefined => {
    let rows = rowsByPath.get(path)
    if (!rows) {
      rows = service.rowsAt(definitions, path)
      rowsByPath.set(path, rows)
    }
    return rows.get(nodeId)
  }

  /** Demoted: a cascade found what it was made from changed. */
  const demoted = (row: PlanNodeRow) => row.status === "OUTDATED" && hasRegenerationCriteria(row)

  /** Something inside the loop, in one of its current iterations, has been demoted. */
  const demotedInside = (loop: PlanNodeDefinition, path: NodePath): boolean => {
    const row = rowAt(loop.id, path)
    for (const key of iterationKeys(loop.type, row?.content)) {
      const iterationPath = childPath(path, loop.id, key)
      for (const child of levelOf(loop.id).nodes) {
        const childRow = rowAt(child.id, iterationPath)
        if (childRow && demoted(childRow)) return true
        if (LOOP_TYPES.has(child.type) && demotedInside(child, iterationPath)) return true
      }
    }
    return false
  }

  const answered = new Map<string, boolean>()
  const isDone = (nodeId: number, path: NodePath): boolean => {
    const key = unitKey(nodeId, path)
    let done = answered.get(key)
    if (done === undefined) {
      done = stillDone(key, nodeId, path)
      answered.set(key, done)
    }
    return done
  }
  const stillDone = (key: string, nodeId: number, path: NodePath): boolean => {
    if (!book.done.has(key)) return false
    const row = rowAt(nodeId, path)
    const definition = byId.get(nodeId)
    if (row === undefined || definition === undefined || demoted(row)) {
      book.done.delete(key)
      return false
    }
    if (LOOP_TYPES.has(definition.type) && demotedInside(definition, path)) {
      book.done.delete(key)
      book.revisit.add(key)
      return false
    }
    return true
  }

  const runsInside = (loopId: number, path: NodePath) => {
    const prefix = childPath(path, loopId, "")
    for (const key of book.running) if (pathOfKey(key).startsWith(prefix)) return true
    return false
  }

  /** In iteration `j`: the loop's output in iterations 0 … j−1 is done. */
  const earlierOutputsDone = (node: PlanNodeDefinition, path: NodePath): boolean => {
    const segment = lastSegment(path)
    const loopId = node.parent_id
    if (loopId === null || !segment || segment.containerId !== loopId) return true
    const output = levelOf(loopId).nodes.find((child) => child.type === "for-each-output")
    if (!output) return true
    const loopPath = parentPath(path)
    const before = Number(segment.key)
    for (let index = 0; index < before; index++) {
      if (!isDone(output.id, childPath(loopPath, loopId, index))) return false
    }
    return true
  }

  const ready: PlanNodeRow[] = []
  const closable: PlanNodeRow[] = []
  const loops: LoopProgress[] = []
  const pending: PlanNodeRow[] = []

  /**
   * One unit: true when it is done, else it is listed as pending and, if it
   * can start or close, as such. `blocked`: a loop around it waits for a
   * source again.
   */
  function visit(node: PlanNodeDefinition, path: NodePath, sourcesDone: boolean, blocked: boolean): boolean {
    if (isDone(node.id, path)) return true
    const row = rowAt(node.id, path)
    if (!row) return false
    pending.push(row)
    const key = unitKey(node.id, path)
    if (book.running.has(key)) return false
    const opened = book.opened.get(key)
    if (opened) {
      if (row.status === "GENERATING") {
        let done = 0
        let current: string | undefined
        for (const iteration of opened.keys) {
          if (visitLevel(node.id, childPath(path, node.id, iteration), blocked || !sourcesDone)) done++
          else current ??= iteration
        }
        loops.push({ row, total: opened.keys.length, done, current: current ?? opened.keys.at(-1) ?? "" })
        if (done === opened.keys.length && sourcesDone && !blocked) closable.push(row)
        return false
      }
      // Demoted while its iterations ran: what it opened is stale. It opens
      // again — its list may have changed — once nothing runs inside it.
      book.opened.delete(key)
    }
    if (blocked || !sourcesDone) return false
    if (node.type === "for-each-prev-outputs" && !earlierOutputsDone(node, path)) return false
    if (LOOP_TYPES.has(node.type) && runsInside(node.id, path)) return false
    ready.push(row)
    return false
  }

  /** The children of `parentId` at `path`: true when every one of them is done. */
  function visitLevel(parentId: number | null, path: NodePath, blocked: boolean): boolean {
    const level = levelOf(parentId)
    let complete = true
    for (const node of level.nodes) {
      const sourcesDone = level.incomingEdges.get(node.id)!.every((source) => isDone(source, path))
      if (!visit(node, path, sourcesDone, blocked)) complete = false
    }
    return complete
  }

  if (scope) {
    const loop = byId.get(scope.loop.nodeId)
    if (loop) visit(loop, scope.loop.path, true, false)
  } else {
    visitLevel(null, ROOT_PATH, false)
  }
  return { ready, closable, loops, pending }
}
