import EventEmitter from "events"
import type { PlanNodeRow } from "../../../../shared/plan-graph.js"
import type { RegenerateEvent } from "../../../../shared/RegenerateEvent.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeService } from "../plan-node-service.js"
import type {
  PlanNodeAiGenerationStatus,
  RegenerationContainerContext,
  RegenerationNodeContext,
} from "./RegenerationContext.js"
import { observable, type Observable } from "@trpc/server/observable"
import { makeErrorWithStatus } from "../../../lib/make-errors.js"
import type { RegenerateOptions } from "../../../../shared/RegenerateOptions.js"

const eventEmitter = new EventEmitter()

function emitRegenerateEvent() {
  eventEmitter.emit("regenerate", {
    inProcess,
    stopping,
    currentNodeStack,
    firstError,
    generatedNew,
    generatedSame,
    generatedEmpty,
    skipped,
  } as RegenerateEvent)
}

export function subscribeToRegenerateTreeNodesContentsProgress(): Observable<RegenerateEvent, unknown> {
  return observable((emit) => {
    let active = true

    const listener = (event: RegenerateEvent) => {
      if (active) {
        emit.next(event)
      }
    }
    eventEmitter.on("regenerate", listener)

    // Функция отписки
    return () => {
      active = false
      eventEmitter.off("regenerate", listener)
    }
  })
}

let inProcess = false
let stopping = false

const currentNodeStack: PlanNodeRow[] = []
let firstError: unknown = null

let generatedNew: number = 0
let generatedSame: number = 0
let generatedEmpty: number = 0
let skipped: number = 0

export function regenerateTreeNodesContentsStop(): void {
  if (inProcess && !stopping) {
    stopping = true
    emitRegenerateEvent()
  }
}

/**
 * Generate content for all nodes in topological order, respecting dependencies.
 */
export async function regenerateTreeNodesContents(options: RegenerateOptions): Promise<void> {
  if (inProcess) throw makeErrorWithStatus("Some regeneration is already in process", 429)
  inProcess = true
  stopping = false
  firstError = null
  currentNodeStack.length = 0

  generatedEmpty = 0
  generatedSame = 0
  generatedNew = 0
  skipped = 0

  console.info("[regenerateTreeNodesContents] Starting regeneration")
  try {
    const containerContext: RegenerationContainerContext = {
      options,
      onNodeSkip() {
        skipped++
        emitRegenerateEvent()
      },
      async onNodeStart<T>(
        node: PlanNodeRow,
        block: (context: RegenerationNodeContext) => Promise<{ result: T; status: PlanNodeAiGenerationStatus }>,
      ) {
        if (stopping) throw Error("Stop was required")
        if (currentNodeStack.length > 0 && currentNodeStack[currentNodeStack.length - 1].id != node.parent_id) {
          throw Error(
            `Only child nodes can be pushed to regeneration processing stack (currentNodeStack).` +
              `Current stack top is ${currentNodeStack[currentNodeStack.length - 1].id}, parent of push node ${node.id} is ${node.parent_id}`,
          )
        }
        currentNodeStack.push(node)
        emitRegenerateEvent()
        try {
          const blockResult = await block(childContext)
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
          stopping = true
          throw e
        } finally {
          currentNodeStack.pop()
          emitRegenerateEvent()
        }
      },
    }

    const childContext: RegenerationNodeContext = {
      options,
      onData: () => {
        if (stopping) throw Error("Stop was required")
      },
      onEvent: () => {
        if (stopping) throw Error("Stop was required")
      },
      async asContainer<T>(
        multiplier: number,
        block: (context: RegenerationContainerContext) => Promise<T>,
      ): Promise<T> {
        if (stopping) throw Error("Stop was required")
        return block(containerContext)
      },
    }

    await regenerateSubtreeNodesContents(containerContext, null)
  } finally {
    inProcess = false
  }
}

/**
 * Generate content for all nodes in topological order, respecting dependencies.
 */
export async function regenerateSubtreeNodesContents(
  context: RegenerationContainerContext,
  parentId: number | null,
): Promise<void> {
  console.info("[regenerateSubtreeNodesContents] Starting regeneration for parentId=" + parentId + "")

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
    GENERATED: true,
    OUTDATED: true,
    MANUAL: context.options.regenerateManual,
  }

  while (queue.length > 0 && !stopping) {
    const nodeId = queue.shift()!
    const node = nodeMap.get(nodeId)!

    // Check if all sources are already checked
    const sources = incomingEdges.get(nodeId)!
    const allSourcesChecked = sources.every((srcId) => checked.has(srcId))
    if (!allSourcesChecked) {
      // Not ready yet, put back at the end of queue (will be revisited later)
      console.log(
        `[PlanNodeService] node ${nodeId} not ready, missing sources: ${sources.filter((srcId) => !checked.has(srcId)).join(",")}`,
      )
      queue.push(nodeId)
      continue
    }

    const willRegenerate = shouldRegenerate[node.status]
    console.log(
      `[PlanNodeService] willRegenerate=${willRegenerate} (regenerateManual=${context.options.regenerateManual})`,
    )

    if (willRegenerate) {
      await context.onNodeStart(node, async (childContext) => {
        const result = await planNodeService.regenerate(childContext, nodeId)
        const status =
          (result.content?.length || 0) === 0 ? "EMPTY" : result.content == node.content ? "SAME" : "GENERATED"
        return { result, status }
      })
    } else {
      console.log(`[PlanNodeService] skipping node ${nodeId}`)
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
