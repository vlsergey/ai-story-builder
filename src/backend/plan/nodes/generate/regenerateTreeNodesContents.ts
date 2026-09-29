import EventEmitter from "node:events"
import type { Observable } from "@trpc/server/observable"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import type { PlanNodeRow } from "../../../../shared/plan-graph.js"
import { childPath, type NodePath, ROOT_PATH } from "../../../../shared/plan-node-path.js"
import type {
  RegenerateStatusEvent,
  RegenerationStackItem,
  RegenerationStackItemIteration,
} from "../../../../shared/RegenerateEvent.js"
import { emitterToObservable, emitterToSingleArgObservable } from "../../../lib/event-manager.js"
import { makeErrorWithStatus } from "../../../lib/make-errors.js"
import { finishRun, runForNode, startRun } from "../../../lib/telemetry/telemetry.js"
import { SettingsRepository } from "../../../settings/settings-repository.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan-node-repository.js"
import { hasState, PlanNodeService } from "../plan-node-service.js"
import { computeLevelDependencies } from "./computeLevelDependencies.js"
import { propagateStaleStatus } from "./propagateStaleStatus.js"
import type {
  PlanNodeAiGenerationStatus,
  RegenerationContainerContext,
  RegenerationCycleContext,
  RegenerationNodeContext,
} from "./RegenerationContext.js"
import { hasRegenerationCriteria } from "./regeneration-criteria.js"

interface RegenerateEvents {
  responseStream: [nodeId: number, path: NodePath, contentPath: (string | number)[], event: ResponseStreamEvent]
  status: [event: RegenerateStatusEvent]
}

const eventEmitter = new EventEmitter<RegenerateEvents>()

function emitRegenerateStatusEvent() {
  const event: RegenerateStatusEvent = {
    inProcess,
    stopping: abortController == null ? true : abortController.signal.aborted,
    // A copy: subscribers may hold the event after the run has moved on.
    currentRegenerationStack: [...running.values()],
    firstError,
    firstErrorAt,
    generatedNew,
    generatedSame,
    generatedEmpty,
    skipped,
  }
  eventEmitter.emit("status", event)
}

export function subscribeToStatusEvents(): Observable<RegenerateStatusEvent, unknown> {
  return emitterToSingleArgObservable(eventEmitter, "status")
}

interface ResponseStreamEventWrapper {
  nodeId: number
  /** The iteration the streaming node runs in: two iterations of one node stream apart. */
  path: NodePath
  contentPath: (string | number)[]
  event: ResponseStreamEvent
}

const eventEmitterTupleToEventMapper = ([nodeId, path, contentPath, event]: RegenerateEvents["responseStream"]) =>
  ({
    nodeId,
    path,
    contentPath,
    event,
  }) satisfies ResponseStreamEventWrapper

export function subscribeToResponseStreamEvents(): Observable<ResponseStreamEventWrapper, unknown> {
  return emitterToObservable(eventEmitter, "responseStream", eventEmitterTupleToEventMapper)
}

let abortController: AbortController | null = null
let inProcess = false

/**
 * What runs now, in the order it started: nodes, and the loop iterations they
 * run in. A parallel loop runs several iterations at once, so this is a set of
 * entries rather than one chain; each entry carries its path.
 */
const running = new Map<object, RegenerationStackItem>()
let firstError: unknown = null
let firstErrorAt: RegenerateStatusEvent["firstErrorAt"] = null

let generatedNew: number = 0
let generatedSame: number = 0
let generatedEmpty: number = 0
let skipped: number = 0

export function stop(): void {
  if (inProcess && !abortController?.signal.aborted) {
    abortController?.abort()
    emitRegenerateStatusEvent()
  }
}

/** Runs `block` shown as `item` among what runs now. */
async function withStackItem<T>(item: RegenerationStackItem, emit: boolean, block: () => Promise<T>): Promise<T> {
  const entry = {}
  running.set(entry, item)
  if (emit) emitRegenerateStatusEvent()
  try {
    return await block()
  } finally {
    running.delete(entry)
    if (emit) emitRegenerateStatusEvent()
  }
}

/** How a finished regeneration is counted in the run's totals. */
function classifyResult(before: PlanNodeRow, after: PlanNodeRow): PlanNodeAiGenerationStatus {
  if ((after.content?.length || 0) === 0) return "EMPTY"
  return after.content === before.content ? "SAME" : "GENERATED"
}

/**
 * Generate content for all nodes in topological order, respecting dependencies.
 * With a target, regenerates that node at that path only and resolves to its
 * row afterwards.
 */
export async function regenerateTreeNodesContents(): Promise<undefined>
export async function regenerateTreeNodesContents(target: { nodeId: number; path: NodePath }): Promise<PlanNodeRow>
export async function regenerateTreeNodesContents(target?: {
  nodeId: number
  path: NodePath
}): Promise<PlanNodeRow | undefined> {
  if (inProcess) throw makeErrorWithStatus("Some regeneration is already in process", 429)
  inProcess = true
  firstError = null
  firstErrorAt = null
  running.clear()

  generatedEmpty = 0
  generatedSame = 0
  generatedNew = 0
  skipped = 0

  const myAbortController = new AbortController()
  abortController = myAbortController
  emitRegenerateStatusEvent()

  const options = {
    regenerateGenerated: SettingsRepository.getAiRegenerateGenerated(),
    regenerateManual: SettingsRepository.getAiRegenerateManual(),
  }

  console.info("[regenerateTreeNodesContents] Starting regeneration")
  // Propagate stale status before the scheduler starts. Without this, a
  // GENERATED downstream node looks ready to run while an upstream (or a
  // loop's child in some iteration) still has OUTDATED/ERROR/EMPTY status.
  const { marked } = propagateStaleStatus({
    regenerateManual: options.regenerateManual,
    regenerateGenerated: options.regenerateGenerated,
  })
  if (marked.length > 0) {
    const list = marked.map(({ nodeId, path }) => (path ? `${nodeId}@${path}` : `${nodeId}`)).join(",")
    console.info(`[regenerateTreeNodesContents] pre-marked OUTDATED via propagation: ${list}`)
  }
  startRun()
  let runSucceeded = true
  try {
    /** The context of one level: the top level, or one iteration of a loop. */
    function containerContext(path: NodePath): RegenerationContainerContext {
      return {
        abortSignal: myAbortController.signal,
        options,
        path,
        onNodeSkip() {
          skipped++
          emitRegenerateStatusEvent()
        },
        async onNodeStart<T>(
          node: PlanNodeRow,
          block: (context: RegenerationNodeContext) => Promise<{ result: T; status: PlanNodeAiGenerationStatus }>,
        ) {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          return await withStackItem({ type: "node", node }, true, async () => {
            try {
              const blockResult = await runForNode({ nodeId: node.id, path: node.path }, () => block(nodeContext(node)))
              switch (blockResult.status) {
                case "SAME":
                  generatedSame++
                  break
                case "EMPTY":
                  generatedEmpty++
                  break
                case "GENERATED":
                  generatedNew++
                  break
              }
              return blockResult.result
            } catch (e) {
              // The innermost node fails first; the loops around it only pass
              // the error on. A stop is not a failure. The error ends the run
              // as it travels up; branches of a parallel loop already running
              // are let finish, so their work is not thrown away.
              if (firstError == null && !myAbortController.signal.aborted) {
                firstError = e
                firstErrorAt = { nodeId: node.id, title: node.title, path: node.path }
              }
              throw e
            }
          })
        },
      }
    }

    function cycleContext(totalIterations: number | undefined, container: PlanNodeRow): RegenerationCycleContext {
      return {
        abortSignal: myAbortController.signal,
        options,
        asNode: async <T>(zeroBasedIterationIndex: number, block: (context: RegenerationNodeContext) => Promise<T>) => {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          const stackItem: RegenerationStackItemIteration = {
            type: "iteration",
            container,
            totalIterations,
            zeroBasedIterationIndex,
          }
          return await withStackItem(stackItem, true, () => block(nodeContext(container)))
        },
        asContainer: async <T>(
          zeroBasedIterationIndex: number,
          block: (context: RegenerationContainerContext) => Promise<T>,
        ) => {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          const stackItem: RegenerationStackItemIteration = {
            type: "iteration",
            container,
            totalIterations,
            zeroBasedIterationIndex,
          }
          // The only place a child path is made: the scheduler and the path cannot disagree.
          const path = childPath(container.path, container.id, zeroBasedIterationIndex)
          return await withStackItem(stackItem, false, () => block(containerContext(path)))
        },
        asContainers: async <T>(
          keys: string[],
          concurrency: number,
          block: (context: RegenerationContainerContext) => Promise<T>,
        ) => {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          const results: T[] = []
          let next = 0
          let failure: { error: unknown } | null = null
          // Each worker takes the next iteration until none is left. After a
          // failure no new iteration starts, but the running ones finish:
          // the run must not end while branches still write.
          const worker = async () => {
            while (failure === null && next < keys.length && !myAbortController.signal.aborted) {
              const index = next++
              const stackItem: RegenerationStackItemIteration = {
                type: "iteration",
                container,
                totalIterations,
                zeroBasedIterationIndex: index,
                key: keys[index],
              }
              const path = childPath(container.path, container.id, keys[index])
              try {
                results[index] = await withStackItem(stackItem, true, () => block(containerContext(path)))
              } catch (error) {
                failure ??= { error }
              }
            }
          }
          const workers = Math.max(1, Math.min(concurrency, keys.length))
          await Promise.all(Array.from({ length: workers }, worker))
          if (failure) throw (failure as { error: unknown }).error
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          return results
        },
      }
    }

    function nodeContext(node: PlanNodeRow): RegenerationNodeContext {
      return {
        abortSignal: myAbortController.signal,
        nodeId: node.id,
        path: node.path,
        options,
        onResponseStreamEvent: (contentPath: (string | number)[], event: ResponseStreamEvent) => {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          eventEmitter.emit("responseStream", node.id, node.path, contentPath, event)
        },
        async asCycle<T>(
          totalIterations: number | undefined,
          block: (context: RegenerationCycleContext) => Promise<T>,
        ): Promise<T> {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          return await block(cycleContext(totalIterations, node))
        },
      }
    }

    if (target === undefined) {
      await regenerateSubtreeNodesContents(containerContext(ROOT_PATH), null)
      return undefined
    }

    // A single node goes through onNodeStart like any other, so it is counted
    // and its failure becomes the run's first error.
    const service = new PlanNodeService()
    service.checkPath(target.nodeId, target.path)
    const node = service.getRow(target.nodeId, target.path)
    await containerContext(target.path).onNodeStart(node, async (context) => {
      const result = await service.regenerate(context)
      return { result, status: classifyResult(node, result) }
    })
    return service.getRow(target.nodeId, target.path)
  } catch (err) {
    runSucceeded = false
    if (firstError == null && !myAbortController.signal.aborted) {
      firstError = err
    }
    throw err
  } finally {
    finishRun({ success: runSucceeded })
    inProcess = false
    abortController = null
    emitRegenerateStatusEvent()
  }
}

/**
 * Generate content for all nodes of one level in topological order, respecting
 * dependencies: the children of `parentId`, in the iteration `context.path`.
 */
export async function regenerateSubtreeNodesContents(
  context: RegenerationContainerContext,
  parentId: number | null,
): Promise<void> {
  const path = context.path
  console.info(`[regenerateSubtreeNodesContents] Starting regeneration for parentId=${parentId} at "${path}"`)

  const planNodeService = new PlanNodeService()
  // Build the dependency graph for this level using a projection that maps
  // every edge to the sibling-level it belongs to. Crucially, an edge whose
  // target lives INSIDE one of this level's containers is still attributed
  // to that container — otherwise the scheduler would happily process the
  // container before its cross-boundary input is ready.
  // See computeLevelDependencies for details and the concrete bug it fixes.
  const allNodes = new PlanNodeRepository().findAll()
  const allEdges = new PlanEdgeRepository().findAll()
  const { nodes, incomingEdges, outgoingEdges } = computeLevelDependencies({ parentId, allNodes, allEdges })
  const nodeIds = nodes.map((n) => n.id)

  // Set of nodes that have been checked (processed)
  const checked = new Set<number>()
  // Queue of nodes to check (initialized with nodes that have no incoming edges)
  const queue: number[] = nodeIds.filter((id) => incomingEdges.get(id)!.length === 0)

  const shouldRegenerate: Record<PlanNodeRow["status"], boolean> = {
    ERROR: true,
    EMPTY: true,
    GENERATING: true,
    GENERATED: context.options.regenerateGenerated,
    OUTDATED: true,
    MANUAL: context.options.regenerateManual,
  }

  /** The node's live state in this level's iteration; undefined once the node is deleted. */
  const liveRow = (id: number): PlanNodeRow | undefined =>
    planNodeService.repo.findById(id) ? planNodeService.getRow(id, path) : undefined

  // Guard against pathological loops caused by repeated cascade demotions.
  // Realistic ceiling: every node may be re-processed a small constant
  // number of times. 10× the node count is generous. Only re-runs count:
  // waiting for sources is legitimate and, in a bad order, takes n² turns.
  let demotionBudget = nodeIds.length * 10
  const spendOnDemotion = () => {
    if (demotionBudget-- <= 0) {
      // Breaking out here would report a half-done run as a success.
      throw Error(`Regeneration did not converge at parentId=${parentId}: nodes ${queue.join(",")} kept being demoted`)
    }
  }
  // Consecutive deferrals: a whole pass over the queue with nobody ready means
  // nobody ever will be — the graph has a cycle.
  let deferredInARow = 0

  while (queue.length > 0 && !context.abortSignal.aborted) {
    if (deferredInARow > queue.length) {
      throw Error(`Regeneration cannot proceed at parentId=${parentId}: nodes ${queue.join(",")} wait for each other`)
    }
    const nodeId = queue.shift()!
    // Refetch the live row — sibling regenerations earlier in this loop may
    // have fired markAsOutdatedAndNotifyDownstreamNodes cascades that demoted
    // this node's status (e.g. for-each-prev-outputs regen → merge demoted →
    // scene demoted), and we must NOT decide based on a stale snapshot.
    const node = liveRow(nodeId)
    if (!node) continue

    // Sources may also have been demoted by intervening cascades. If a source
    // was checked but its live status indicates an external demotion, un-check
    // it so it re-runs before we process this node.
    //
    // A source counts as "demoted" only when its status is OUTDATED — that's
    // the value markAsOutdatedAndNotifyDownstreamNodes assigns when a cascade
    // fires. EMPTY is NOT a demotion: it's a valid
    // terminal state for a merge whose input was legitimately empty (e.g., a
    // for-each-prev-outputs on iteration 0), and counting it as one creates
    // an infinite re-queue loop where the merge re-runs every time its
    // downstream consumer tries to process it. ERROR is excluded for the same
    // reason — retrying tends to hit the same failure.
    const sources = incomingEdges.get(nodeId)!
    let anySourceDemoted = false
    for (const srcId of sources) {
      if (!checked.has(srcId)) continue
      const liveSrc = liveRow(srcId)
      if (liveSrc && liveSrc.status === "OUTDATED" && hasRegenerationCriteria(liveSrc)) {
        console.log(
          `[regenerateSubtreeNodesContents] source ${srcId} demoted to OUTDATED since it was processed; re-queueing it before ${nodeId}`,
        )
        checked.delete(srcId)
        if (!queue.includes(srcId)) queue.push(srcId)
        anySourceDemoted = true
      }
    }
    if (anySourceDemoted) {
      // Defer current node until the demoted sources catch up.
      spendOnDemotion()
      deferredInARow = 0
      queue.push(nodeId)
      continue
    }

    // Check if all sources are already checked
    const allSourcesChecked = sources.every((srcId) => checked.has(srcId))
    if (!allSourcesChecked) {
      // Not ready yet, put back at the end of queue (will be revisited later)
      console.log(
        `[regenerateSubtreeNodesContents] node ${nodeId} not ready, missing sources: ${sources.filter((srcId) => !checked.has(srcId)).join(",")}`,
      )
      deferredInARow++
      queue.push(nodeId)
      continue
    }
    deferredInARow = 0

    const willRegenerate = shouldRegenerate[node.status] && hasRegenerationCriteria(node)
    console.log(
      `[regenerateSubtreeNodesContents] willRegenerate=${willRegenerate} (regenerateManual=${context.options.regenerateManual})`,
    )

    if (willRegenerate) {
      await context.onNodeStart(node, async (childContext) => {
        const result = await planNodeService.regenerate(childContext)
        return { result, status: classifyResult(node, result) }
      })
      // Its prompt or an input changed while it was being written, so its
      // result was dropped: write it again before anything reads it. Nothing
      // else would — a node without readers is never re-queued as a source.
      if (liveRow(nodeId)?.status === "OUTDATED" && !context.abortSignal.aborted) {
        spendOnDemotion()
        queue.unshift(nodeId)
        continue
      }
    } else {
      console.log(
        `[regenerateSubtreeNodesContents] skipping node ${nodeId} '${node.title}' of type ${node.type} with status '${node.status}' at "${path}"`,
      )
      // A node with nothing to generate from settles here: pending, it would
      // stay pending for good. What it holds is the user's; nothing is EMPTY.
      if (!hasRegenerationCriteria(node) && (!hasState(node) || node.status === "OUTDATED")) {
        await planNodeService.patchState(nodeId, path, false, { status: node.content?.trim() ? "MANUAL" : "EMPTY" })
      }
      // Determine skip reason based on node status and regenerateManual
      let skipReason = ""
      if (node.status === "MANUAL" && !context.options.regenerateManual) {
        skipReason = "MANUAL node (regenerateManual is false)"
      } else if (node.status === "GENERATED") {
        skipReason = "already GENERATED"
      } else {
        skipReason = `status ${node.status} (no regeneration condition met)`
      }
      context.onNodeSkip(node, skipReason)
    }

    // Mark as checked
    checked.add(nodeId)

    // Add outgoing nodes to queue if not already in queue and not checked
    const outgoing = outgoingEdges.get(nodeId)!
    for (const outId of outgoing) {
      if (!checked.has(outId) && !queue.includes(outId)) {
        queue.push(outId)
      }
    }
  }
}
