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
import { SettingsRepository } from "../../../settings/settings-repository.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeService } from "../plan-node-service.js"
import type {
  PlanNodeAiGenerationStatus,
  RegenerationContainerContext,
  RegenerationCycleContext,
  RegenerationNodeContext,
} from "./RegenerationContext.js"

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
    currentRegenerationStack: currentRegenerationStack,
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
 * Generate content for all nodes in topological order, respecting dependencies.
 */
export async function regenerateTreeNodesContents(nodeId?: number): Promise<void> {
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
        currentRegenerationStack.push({ type: "node", node: node })
        emitRegenerateStatusEvent()
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
        } finally {
          currentRegenerationStack.pop()
          emitRegenerateStatusEvent()
        }
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
          currentRegenerationStack.push(stackItem)
          emitRegenerateStatusEvent()
          try {
            return await block(nodeContext(container))
          } finally {
            const popped = currentRegenerationStack.pop()
            if (popped !== stackItem) {
              console.error("Stack item mismatch", popped, stackItem)
              // biome-ignore lint/correctness/noUnsafeFinally: that panic error anyway
              throw Error("Stack item mismatch")
            }
            emitRegenerateStatusEvent()
          }
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
          currentRegenerationStack.push(stackItem)
          try {
            return await block(containerContext)
          } finally {
            const popped = currentRegenerationStack.pop()
            if (popped !== stackItem) {
              console.error("Stack item mismatch", popped, stackItem)
              // biome-ignore lint/correctness/noUnsafeFinally: that panic error anyway
              throw Error("Stack item mismatch")
            }
          }
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
    } else {
      const service = new PlanNodeService()
      const node = service.getById(nodeId)
      const stackItem: RegenerationStackItem = { type: "node", node: node }
      currentRegenerationStack.push(stackItem)
      emitRegenerateStatusEvent()

      try {
        await new PlanNodeService().regenerate(nodeContext(node))
      } finally {
        const popped = currentRegenerationStack.pop()
        if (popped !== stackItem) {
          console.error("Stack item mismatch", popped, stackItem)
          // biome-ignore lint/correctness/noUnsafeFinally: that panic error anyway
          throw Error("Stack item mismatch")
        }
      }
    }
  } finally {
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

  const planEdgeRepository = new PlanEdgeRepository()
  const planNodeService = new PlanNodeService()

  // Get nodes with specific parent_id
  const nodes = planNodeService.findByParentId(parentId)
  const nodeIds = nodes.map((n) => n.id)
  const incomingEdges = new Map<number, number[]>()
  const outgoingEdges = new Map<number, number[]>()

  for (const nodeId of nodeIds) {
    incomingEdges.set(nodeId, [])
    outgoingEdges.set(nodeId, [])
  }

  // Fill adjacency from edges, but only edges where both nodes are in our node set
  const edgeRows = planEdgeRepository.findAll()
  for (const edge of edgeRows) {
    if (nodeIds.includes(edge.from_node_id) && nodeIds.includes(edge.to_node_id)) {
      incomingEdges.get(edge.to_node_id)!.push(edge.from_node_id)
      outgoingEdges.get(edge.from_node_id)!.push(edge.to_node_id)
    }
  }

  // Set of nodes that have been checked (processed)
  const checked = new Set<number>()
  // Queue of nodes to check (initialized with nodes that have no incoming edges)
  const queue: number[] = nodeIds.filter((id) => incomingEdges.get(id)!.length === 0)
  // Map from node id to its data
  const nodeMap = new Map<number, PlanNodeRow>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  const shouldRegenerate: Record<PlanNodeRow["status"], boolean> = {
    ERROR: true,
    EMPTY: true,
    GENERATING: true,
    GENERATED: context.options.regenerateManual,
    OUTDATED: true,
    MANUAL: context.options.regenerateManual,
  }

  while (queue.length > 0 && !context.abortSignal.aborted) {
    const nodeId = queue.shift()!
    const node = nodeMap.get(nodeId)!

    // Check if all sources are already checked
    const sources = incomingEdges.get(nodeId)!
    const allSourcesChecked = sources.every((srcId) => checked.has(srcId))
    if (!allSourcesChecked) {
      // Not ready yet, put back at the end of queue (will be revisited later)
      console.log(
        `[regenerateSubtreeNodesContents] node ${nodeId} not ready, missing sources: ${sources.filter((srcId) => !checked.has(srcId)).join(",")}`,
      )
      queue.push(nodeId)
      continue
    }

    const willRegenerate = shouldRegenerate[node.status]
    console.log(
      `[regenerateSubtreeNodesContents] willRegenerate=${willRegenerate} (regenerateManual=${context.options.regenerateManual})`,
    )

    if (willRegenerate) {
      await context.onNodeStart(node, async (childContext) => {
        const result = await planNodeService.regenerate(childContext)
        const status =
          (result.content?.length || 0) === 0 ? "EMPTY" : result.content === node.content ? "SAME" : "GENERATED"
        return { result, status }
      })
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
