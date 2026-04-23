import type { Observable } from "@trpc/server/observable"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import { isValidNodeType, NODE_TYPES } from "../../../shared/node-edge-dictionary.js"
import type { PlanNodeCreate, PlanNodeRow } from "../../../shared/plan-graph.js"
import { type DataOrEventEvent, toObservable } from "../../lib/event-manager.js"
import { makeErrorWithStatus } from "../../lib/make-errors.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import type {
  PlanNodeAiGenerationStatus,
  RegenerationContainerContext,
  RegenerationCycleContext,
  RegenerationNodeContext,
} from "./generate/RegenerationContext.js"
import { PlanNodeService } from "./plan-node-service.js"

export function aiRegenerateNodeContentWatchAndReview(
  nodeId: number,
): Observable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>, unknown> {
  const service = new PlanNodeService()
  const oldNode = service.getById(nodeId)
  const options = {
    regenerateGenerated: SettingsRepository.getAiRegenerateGenerated(),
    regenerateManual: SettingsRepository.getAiRegenerateManual(),
  }

  return toObservable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>>(async (emit) => {
    const asCycle: RegenerationNodeContext["asCycle"] = async <T>(
      _totalIterations: number | undefined,
      block: (context: RegenerationCycleContext) => Promise<T>,
    ) => {
      return await block({
        options,
        asContainer: (_iteration, block) => asContainer(block),
        asNode: async (_iteration, block) => await block(childNodesContext),
      })
    }

    const asContainer: RegenerationNodeContext["asContainer"] = async <T>(
      block: (context: RegenerationContainerContext) => Promise<T>,
    ) => {
      return await block({
        options,
        onNodeStart: async (
          node,
          block: (context: RegenerationNodeContext) => Promise<{ result: T; status: PlanNodeAiGenerationStatus }>,
        ) => {
          return await block(childNodesContext)
        },
      } as RegenerationContainerContext)
    }

    // ignore events on child nodes generation here
    const childNodesContext: RegenerationNodeContext = {
      options,
      onData: () => {},
      onEvent: () => {},
      asContainer,
      asCycle,
    }

    const mainNodeContext: RegenerationNodeContext = {
      options,
      onData: (data) => {
        emit.next({ type: "data", data })
      },
      onEvent: (event) => {
        emit.next({ type: "event", event })
      },
      asCycle,
      asContainer,
    }

    const result = await service.regenerate(mainNodeContext, nodeId)

    const newNode = await service.patch(nodeId, false, {
      in_review: (result.content?.trim()?.length || 0) > 0 ? 1 : 0,
      review_base_content: oldNode.content,
    })

    emit.next({ type: "data", data: newNode })
    emit.next({ type: "completed" })
  })
}

export async function aiRegenerateNodeContentOnly(nodeId: number): Promise<PlanNodeRow> {
  const options = {
    regenerateGenerated: SettingsRepository.getAiRegenerateGenerated(),
    regenerateManual: SettingsRepository.getAiRegenerateManual(),
  }

  const asCycle: RegenerationNodeContext["asCycle"] = async <T>(
    _totalIterations: number | undefined,
    block: (context: RegenerationCycleContext) => Promise<T>,
  ) => {
    return await block({
      options,
      asContainer: (_iteration, block) => asContainer(block),
      asNode: async (_iteration, block) => await block(nodeContext),
    })
  }
  const asContainer: RegenerationNodeContext["asContainer"] = async <T>(
    block: (context: RegenerationContainerContext) => Promise<T>,
  ) => {
    return await block({
      options,
      onNodeStart: async (
        node,
        block: (context: RegenerationNodeContext) => Promise<{ result: T; status: PlanNodeAiGenerationStatus }>,
      ) => {
        return await block(nodeContext)
      },
    } as RegenerationContainerContext)
  }
  // ignore events on all nodes generation here
  const nodeContext: RegenerationNodeContext = {
    options,
    onData: () => {},
    onEvent: () => {},
    asContainer,
    asCycle,
  }

  return await new PlanNodeService().regenerate(nodeContext, nodeId)
}

export function createPlanNode(data: PlanNodeCreate): { id: number | bigint } {
  if (!data.title) throw makeErrorWithStatus("title required", 400)
  // Validate type if provided
  if (data.type !== undefined && !isValidNodeType(data.type)) {
    const valid = NODE_TYPES.map((nt) => nt.id).join(", ")
    throw makeErrorWithStatus(`Invalid node type "${data.type}". Valid types: ${valid}`, 400)
  }

  const result = new PlanNodeService().create(data)
  return { id: result.id }
}
