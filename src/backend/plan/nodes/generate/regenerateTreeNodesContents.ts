import EventEmitter from "node:events"
import type { Observable } from "@trpc/server/observable"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import type { PlanNodeRow } from "../../../../shared/plan-graph.js"
import type {
  RegenerateStatusEvent,
  RegenerationStackItem,
  RegenerationStackItemIteration,
} from "../../../../shared/RegenerateEvent.js"
import { emitterToObservable, emitterToSingleArgObservable } from "../../../lib/event-manager.js"
import { makeErrorWithStatus } from "../../../lib/make-errors.js"
import { finishRun, startRun } from "../../../lib/telemetry/telemetry.js"
import { SettingsRepository } from "../../../settings/settings-repository.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan-node-repository.js"
import { PlanNodeService } from "../plan-node-service.js"
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
  nodeUpdate: [node: PlanNodeRow]
  responseStream: [nodeId: number, contentPath: (string | number)[], event: ResponseStreamEvent]
  status: [event: RegenerateStatusEvent]
}

const eventEmitter = new EventEmitter<RegenerateEvents>()

function emitRegenerateStatusEvent() {
  const event: RegenerateStatusEvent = {
    inProcess,
    stopping: abortController == null ? true : abortController.signal.aborted,
    // A copy: subscribers may hold the event after the stack has moved on.
    currentRegenerationStack: [...currentRegenerationStack],
    firstError,
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
  contentPath: (string | number)[]
  event: ResponseStreamEvent
}

const eventEmitterTupleToEventMapper = ([nodeId, contentPath, event]: [
  nodeId: number,
  contentPath: (string | number)[],
  event: ResponseStreamEvent,
]) =>
  ({
    nodeId,
    contentPath,
    event,
  }) satisfies ResponseStreamEventWrapper

export function subscribeToResponseStreamEvents(): Observable<ResponseStreamEventWrapper, unknown> {
  return emitterToObservable(eventEmitter, "responseStream", eventEmitterTupleToEventMapper)
}

let abortController: AbortController | null = null
let inProcess = false

const currentRegenerationStack: RegenerationStackItem[] = []
let firstError: unknown = null

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

/**
 * Pops `item` off the progress stack and says whether it was on top. Never
 * throws: it runs while an error may be in flight, and must not replace it.
 */
function popStackItem(item: RegenerationStackItem): boolean {
  const popped = currentRegenerationStack.pop()
  if (popped === item) return true
  console.error("Stack item mismatch", popped, item)
  return false
}

/** Runs `block` with `item` on the progress stack. */
async function withStackItem<T>(item: RegenerationStackItem, emit: boolean, block: () => Promise<T>): Promise<T> {
  currentRegenerationStack.push(item)
  if (emit) emitRegenerateStatusEvent()
  let result: T
  try {
    result = await block()
  } catch (e) {
    popStackItem(item)
    if (emit) emitRegenerateStatusEvent()
    throw e
  }
  const onTop = popStackItem(item)
  if (emit) emitRegenerateStatusEvent()
  if (!onTop) throw Error("Stack item mismatch")
  return result
}

/** How a finished regeneration is counted in the run's totals. */
function classifyResult(before: PlanNodeRow, after: PlanNodeRow): PlanNodeAiGenerationStatus {
  if ((after.content?.length || 0) === 0) return "EMPTY"
  return after.content === before.content ? "SAME" : "GENERATED"
}

/**
 * Generate content for all nodes in topological order, respecting dependencies.
 * With `nodeId`, regenerates that node only and resolves to its row afterwards.
 */
export async function regenerateTreeNodesContents(): Promise<undefined>
export async function regenerateTreeNodesContents(nodeId: number): Promise<PlanNodeRow>
export async function regenerateTreeNodesContents(nodeId?: number): Promise<PlanNodeRow | undefined> {
  if (inProcess) throw makeErrorWithStatus("Some regeneration is already in process", 429)
  inProcess = true
  firstError = null
  currentRegenerationStack.length = 0

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
  // for-each container's descendant) still has OUTDATED/ERROR/EMPTY status.
  const { markedNodeIds } = propagateStaleStatus({
    regenerateManual: options.regenerateManual,
    regenerateGenerated: options.regenerateGenerated,
  })
  if (markedNodeIds.length > 0) {
    console.info(`[regenerateTreeNodesContents] pre-marked OUTDATED via propagation: ${markedNodeIds.join(",")}`)
  }
  startRun()
  let runSucceeded = true
  try {
    const containerContext: RegenerationContainerContext = {
      abortSignal: myAbortController.signal,
      options,
      onNodeSkip() {
        skipped++
        emitRegenerateStatusEvent()
      },
      async onNodeStart<T>(
        node: PlanNodeRow,
        block: (context: RegenerationNodeContext) => Promise<{ result: T; status: PlanNodeAiGenerationStatus }>,
      ) {
        if (myAbortController.signal.aborted) throw Error("Stop was required")
        if (currentRegenerationStack.length > 0) {
          const topStackItem = currentRegenerationStack[currentRegenerationStack.length - 1]
          if (topStackItem.type === "node" && topStackItem.node.id !== node.parent_id) {
            throw Error(
              `Only child nodes can be pushed to regeneration processing stack (currentNodeStack).` +
                `Current stack top is ${topStackItem.node.id}, parent of push node ${node.id} is ${node.parent_id}`,
            )
          }
        }
        return await withStackItem({ type: "node", node: node }, true, async () => {
          try {
            const blockResult = await block(nodeContext(node))
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
            if (firstError == null) {
              firstError = e
            }
            myAbortController.abort()
            throw e
          }
        })
      },
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
          return await withStackItem(stackItem, false, () => block(containerContext))
        },
      }
    }

    function nodeContext(node: PlanNodeRow): RegenerationNodeContext {
      return {
        abortSignal: myAbortController.signal,
        nodeId: node.id,
        options,
        onNodeUpdated: (node: PlanNodeRow) => {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          eventEmitter.emit("nodeUpdate", node)
        },
        onResponseStreamEvent: (contentPath: (string | number)[], event: ResponseStreamEvent) => {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          eventEmitter.emit("responseStream", node.id, contentPath, event)
        },
        async asContainer<T>(block: (context: RegenerationContainerContext) => Promise<T>): Promise<T> {
          if (myAbortController.signal.aborted) throw Error("Stop was required")
          return await block(containerContext)
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

    if (nodeId === undefined) {
      await regenerateSubtreeNodesContents(containerContext, null)
      return undefined
    }

    // A single node goes through onNodeStart like any other, so it is counted
    // and its failure becomes the run's first error.
    const service = new PlanNodeService()
    const node = service.getById(nodeId)
    await containerContext.onNodeStart(node, async (context) => {
      const result = await service.regenerate(context)
      return { result, status: classifyResult(node, result) }
    })
    return service.getById(nodeId)
  } catch (err) {
    runSucceeded = false
    if (firstError == null) {
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
 * Generate content for all nodes in topological order, respecting dependencies.
 */
export async function regenerateSubtreeNodesContents(
  context: RegenerationContainerContext,
  parentId: number | null,
): Promise<void> {
  console.info(`[regenerateSubtreeNodesContents] Starting regeneration for parentId=${parentId}`)

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

  const nodeRepo = new PlanNodeRepository()
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
    const node = nodeRepo.findById(nodeId)
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
      const liveSrc = nodeRepo.findById(srcId)
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
      if (nodeRepo.findById(nodeId)?.status === "OUTDATED" && !context.abortSignal.aborted) {
        spendOnDemotion()
        queue.unshift(nodeId)
        continue
      }
    } else {
      console.log(
        `[regenerateSubtreeNodesContents] skipping node ${nodeId} '${node.title}' of type ${node.type} with status '${node.status}'`,
      )
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
