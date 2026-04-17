import type {
  PlanNodeCreate,
  PlanNodeUpdate,
  PlanNodeType,
  PlanNodeRow,
  PlanNodeStatus,
  PlanEdgeType,
} from "../../../shared/plan-graph.js"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { PlanEdgeRepository } from "../edges/plan-edge-repository.js"
import {
  isValidNodeType,
  NODE_TYPES,
  getNodeTypeDefinition,
  type EdgeTypeToOutputTypeMap,
} from "../../../shared/node-edge-dictionary.js"
import getDifference from "../../../shared/getDifference.js"
import { planNodeEventManager } from "./plan-node-event-manager.js"
import type { NodeProcessor } from "./graph/node-processor.js"
import { TextProcessor } from "./graph/text-processor.js"
import { LoreProcessor } from "./graph/lore-processor.js"
import { SplitProcessor } from "./graph/split-processor.js"
import { MergeProcessor } from "./graph/merge-processor.js"
import { ForEachProcessor } from "./graph/for-each-processor.js"
import { mergeNodeSettings } from "./graph/settings-helper.js"
import { type DataOrEventEvent, toObservable } from "../../lib/event-manager.js"
import { improvePlanNodeContent } from "../../routes/improve-plan-node-content.js"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import type { Observable } from "@trpc/server/observable"
import { generateSummary } from "../../ai/generate-summary.js"
import { makeErrorWithStatus } from "../../lib/make-errors.js"
import type { ForEachNodeContent } from "../../../shared/for-each-plan-node.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import { ForEachOutputProcessor } from "./graph/for-each-output-processor.js"
import { ForEachInputProcessor } from "./graph/for-each-input-processor.js"
import { ForEachPrevOutputsProcessor } from "./graph/for-each-prev-outputs-processor.js"
import type { RegenerationNodeContext } from "./generate/RegenerationContext.js"
import { promises as fs } from "node:fs"
import { FixProblemsProcessor } from "./graph/fix-problems-processor.js"
import type { NodeInputs } from "./NodeInput.js"

export type NodeUpdateEvent = {
  nodeId: number
  updatedFields: Partial<PlanNodeRow>
}

export const NODE_PROCESSORS: Record<PlanNodeType, NodeProcessor> = {
  "fix-problems": new FixProblemsProcessor(),
  "for-each": new ForEachProcessor(),
  "for-each-input": new ForEachInputProcessor(),
  "for-each-output": new ForEachOutputProcessor(),
  "for-each-prev-outputs": new ForEachPrevOutputsProcessor(),
  text: new TextProcessor(),
  lore: new LoreProcessor(),
  split: new SplitProcessor(),
  merge: new MergeProcessor(),
}

const DO_NOT_NOTIFY_DOWNSTREAMS_ON_CHANGES_IN: (keyof PlanNodeRow)[] = [
  "x",
  "y",
  "width",
  "height",
  "word_count",
  "char_count",
  "byte_count",
  "in_review",
  "review_base_content",
  "ai_improve_instruction",
  "created_at",
] as const

/**
 * Service for plan node operations.
 * Encapsulates business logic and emits events on changes.
 */
export class PlanNodeService {
  readonly repo: PlanNodeRepository = new PlanNodeRepository()

  getById(id: number): PlanNodeRow {
    const result = this.repo.findById(id)
    if (!result) {
      throw makeErrorWithStatus(`Plan node ${id} not found`, 404)
    }
    return result
  }

  getByIds(ids: number[]): PlanNodeRow[] {
    return this.repo.findByIds(ids).map((result) => {
      if (!result) {
        throw makeErrorWithStatus(`Plan node not found`, 404)
      }
      return result
    })
  }

  findByParentId(parentId: number | null): PlanNodeRow[] {
    return this.repo.findByParentId(parentId)
  }

  findByParentIdAndType(parentId: number | null, type: PlanNodeType): PlanNodeRow[] {
    return this.repo.findByParentIdAndType(parentId, type)
  }

  count(): number {
    return this.repo.count()
  }

  getProcessor(nodeType: PlanNodeType): NodeProcessor {
    return NODE_PROCESSORS[nodeType]
  }

  getNodeSettings(node: PlanNodeRow): unknown {
    const processor = this.getProcessor(node.type)
    if (!processor) {
      // No processor, return empty object
      return {}
    }
    // processor.defaultSettings is of type unknown, but we know it's a Record<string, any>
    return mergeNodeSettings(processor.defaultSettings as Record<string, any>, node.node_type_settings)
  }

  findNodeInputs(nodeId: number): NodeInputs<unknown> {
    const incomingEdges = new PlanEdgeRepository().findByToNodeId(nodeId)
    const inputs = []

    for (const edge of incomingEdges) {
      const sourceNode = this.getById(edge.from_node_id)
      if (!sourceNode) continue
      const processor = this.getProcessor(sourceNode.type)
      if (!processor) continue
      const input = processor.getOutput(this, sourceNode)
      inputs.push({ edge, sourceNode, input })
    }

    return inputs.sort((a, b) => a.edge.position - b.edge.position)
  }

  findNodeInputsByType<T extends PlanEdgeType>(nodeId: number, type: T): NodeInputs<EdgeTypeToOutputTypeMap[T]> {
    const incomingEdges = new PlanEdgeRepository().findByToNodeIdAndType(nodeId, type)
    const inputs = []

    for (const edge of incomingEdges) {
      const sourceNode = this.getById(edge.from_node_id)
      if (!sourceNode) continue
      const processor = this.getProcessor(sourceNode.type)
      if (!processor) continue
      const input = processor.getOutput(this, sourceNode) as EdgeTypeToOutputTypeMap[T]
      inputs.push({ edge, sourceNode, input })
    }

    return inputs.sort((a, b) => a.edge.position - b.edge.position)
  }

  getNodeOutput(nodeId: number): unknown {
    const node = this.getById(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    const processor = this.getProcessor(node.type)
    if (!processor) throw new Error(`No processor for node type ${node.type}`)
    return processor.getOutput(this, node)
  }

  /**
   * Notify all downstream nodes that a node's content has changed.
   * This calls each downstream node's onInputContentChange method (if defined).
   * If the processor returns updated PlanNodeRow, the node will be updated (if content changed)
   * and downstream notifications will propagate further.
   */
  async markAsOutdatedAndNotifyDownstreamNodes(changedNodeId: number): Promise<void> {
    const outgoingEdges = new PlanEdgeRepository().findByFromNodeId(changedNodeId)
    for (const edge of outgoingEdges) {
      const downstreamNode = this.getById(edge.to_node_id)
      if (!downstreamNode) continue

      let downstreamUpdate: PlanNodeUpdate = { status: "OUTDATED" }
      let toBeAfterUpdate: PlanNodeRow = { ...downstreamNode, ...downstreamUpdate }

      const processor = this.getProcessor(downstreamNode.type)
      if (processor?.onInputContentChange) {
        console.log(
          `Notifying downstream node ${downstreamNode.id} (${downstreamNode.type}) of changes in node ${changedNodeId}`,
        )
        const settings = this.getNodeSettings(downstreamNode)

        downstreamUpdate = {
          ...downstreamUpdate,
          ...(await processor.onInputContentChange(this, toBeAfterUpdate, changedNodeId, settings)),
        }
        toBeAfterUpdate = { ...downstreamNode, ...downstreamUpdate }
      }

      if (Object.keys(getDifference(downstreamNode, toBeAfterUpdate)).length !== 0) {
        console.log(
          `[PlanNodeService] Updating downstream node ${downstreamNode.id} (${downstreamNode.type}) ` +
            `because of changes in node ${changedNodeId}: ${Object.keys(downstreamUpdate)}`,
        )
        await this.patch(downstreamNode.id, false, downstreamUpdate)
      }
    }
  }

  // ─── Create ──────────────────────────────────────────────────────────────────

  create(data: PlanNodeCreate): { id: number } {
    if (!data.title) throw makeErrorWithStatus("title required", 400)
    // Validate type if provided
    if (data.type !== undefined && !isValidNodeType(data.type)) {
      const valid = NODE_TYPES.map((nt) => nt.id).join(", ")
      throw makeErrorWithStatus(`Invalid node type "${data.type}". Valid types: ${valid}`, 400)
    }
    const type = data.type

    // Check if node type can be created manually
    const nodeDef = NODE_TYPES.find((nt) => nt.id === type)
    if (nodeDef && nodeDef.canCreate === false) {
      throw makeErrorWithStatus(`Node type "${type}" cannot be created manually.`, 400)
    }

    // Determine status based on content
    let status: PlanNodeStatus = "EMPTY"
    let wordCount = 0,
      charCount = 0,
      byteCount = 0
    if (data.content && data.content.trim() !== "") {
      status = "MANUAL"
      wordCount = this.countWords(data.content)
      charCount = this.countChars(data.content)
      byteCount = this.countBytes(data.content)
    }

    const id = this.repo.insert({
      ...data,
      status,
      word_count: wordCount,
      char_count: charCount,
      byte_count: byteCount,
    })
    console.info(`Created node ${id} of type ${type}`)

    // If this is a for-each node, automatically create its internal input/output nodes
    if (type === "for-each") {
      this.createForEachInternalNodes(id, data.x ?? 0, data.y ?? 0)
    }

    planNodeEventManager.emitUpdate(id)
    return { id }
  }

  /**
   * Create internal input and output nodes for a for-each node.
   * These nodes are placed inside the for-each node (as children) and cannot be deleted.
   */
  private createForEachInternalNodes(parentId: number, parentX: number, parentY: number): void {
    // Create for-each-input node
    const inputId = this.repo.insert({
      type: "for-each-input",
      title: "Input",
      parent_id: parentId,
      x: parentX - 50,
      y: parentY + 50,
      content: null,
      ai_user_prompt: null,
      ai_system_prompt: null,
      summary: null,
      ai_sync_info: null,
      node_type_settings: JSON.stringify({}),
      ai_settings: null,
      status: "EMPTY",
      in_review: 0,
      review_base_content: null,
      word_count: 0,
      char_count: 0,
      byte_count: 0,
    })
    // Create for-each-output node
    const outputId = this.repo.insert({
      type: "for-each-output",
      title: "Output",
      parent_id: parentId,
      x: parentX + 50,
      y: parentY + 50,
      content: null,
      ai_user_prompt: null,
      ai_system_prompt: null,
      summary: null,
      ai_sync_info: null,
      node_type_settings: JSON.stringify({}),
      ai_settings: null,
      status: "EMPTY",
      in_review: 0,
      review_base_content: null,
      word_count: 0,
      char_count: 0,
      byte_count: 0,
    })
    console.info(`Created internal nodes for for-each ${parentId}: input ${inputId}, output ${outputId}`)
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  /**
   * Start a review for a node, optionally updating content and setting the improve instruction.
   * If content is provided, it will replace the current content.
   * Sets changes_status = 'review' and stores review_base_content if not already in review.
   */
  async startReview(id: number, patch?: PlanNodeUpdate): Promise<PlanNodeRow> {
    const oldNode = this.repo.findById(id)
    if (!oldNode) throw makeErrorWithStatus("node not found", 404)

    const updateFields: PlanNodeUpdate = {
      ...patch,
      in_review: 1,
    }

    return await this.patch(id, true, updateFields)
  }

  /**
   * Accept the current review, clearing review state.
   */
  async acceptReview(id: number): Promise<PlanNodeRow> {
    const oldNode = this.repo.findById(id)
    if (!oldNode) throw makeErrorWithStatus("node not found", 404)

    return await this.patch(id, true, {
      in_review: 0,
      review_base_content: null,
    })
  }

  /**
   * Update multiple fields of a node (generic patch).
   * Handles merge node regeneration if needed.
   */
  async patch(nodeId: number, manual: boolean, data: PlanNodeUpdate): Promise<PlanNodeRow> {
    const oldNode = this.repo.findById(nodeId)
    if (!oldNode) throw makeErrorWithStatus("node not found", 404)

    // Validate parent_id if present
    if (data.parent_id !== undefined) {
      const newParentId = data.parent_id

      // Check if node type is confined (cannot be moved)
      const nodeDef = getNodeTypeDefinition(oldNode.type)
      if (nodeDef?.confined && data.parent_id !== oldNode.parent_id) {
        throw makeErrorWithStatus(`Node type ${oldNode.type} cannot be moved`, 403)
      }

      // Cannot set parent to itself
      if (newParentId === nodeId) {
        throw makeErrorWithStatus("cannot set parent to itself", 400)
      }

      // If parent is not null, ensure it exists and check for cycles
      if (newParentId !== null) {
        const target = this.repo.findById(newParentId)
        if (!target) throw makeErrorWithStatus("target parent does not exist", 400)

        // Check for cycles
        let cur: number | null = newParentId
        while (cur !== null) {
          if (cur === nodeId) throw makeErrorWithStatus("cannot move node into its own descendant", 400)
          const parent = this.repo.findById(cur)
          cur = parent?.parent_id ?? null
        }
      }
    }

    let update: PlanNodeUpdate = { ...data }

    if (data.status !== undefined) {
      console.log(`In patch there is a requirement to change status to ${data.status}`)
    } else {
      if (update.content !== undefined) {
        if (!update.content) {
          console.log("Status will be changed to EMPTY because content is empty")
          update.status = "EMPTY"
        } else {
          if (manual) {
            console.log("Status will be changed to MANUAL because content is not empty and manual is true")
            update.status = "MANUAL"
          } else {
            console.log("Status will be changed to GENERATED because content is not empty and manual is false")
            update.status = "GENERATED"
          }
        }
      }
      if (update.status === undefined && (update.ai_user_prompt !== undefined || update.ai_user_prompt !== undefined)) {
        update.status = "OUTDATED"
      }
    }

    update = {
      ...update,
      ...(await this.mayBeInvokeOnUpdate(nodeId, oldNode, { ...oldNode, ...update })),
    }

    const updated = Object.keys(update).length !== 0 ? this.repo.patch(nodeId, update) : oldNode
    if (!updated) throw makeErrorWithStatus("node not found", 404)

    // Emit event to frontend
    planNodeEventManager.emitUpdate(nodeId, `patched keys: ${Object.keys(data).join(", ")}`)

    // If important field is changed, notify downstream nodes
    const needToNotify = (Object.keys(update) as (keyof PlanNodeUpdate)[]).every(
      (key) => !DO_NOT_NOTIFY_DOWNSTREAMS_ON_CHANGES_IN.includes(key),
    )
    if (needToNotify) {
      await this.markAsOutdatedAndNotifyDownstreamNodes(nodeId)
    }

    return updated
  }

  private async mayBeInvokeOnUpdate<
    N extends PlanNodeRow | null = PlanNodeRow,
    T extends Record<string, any> = Record<string, any>,
  >(nodeId: number, oldNode: PlanNodeRow | null, newNode: N): Promise<PlanNodeUpdate | null> {
    const type = oldNode?.type ?? newNode?.type
    if (!type) return null

    const nodeProcessor = this.getProcessor(type) as NodeProcessor<T>

    const settings = newNode?.node_type_settings
      ? mergeNodeSettings(nodeProcessor.defaultSettings, newNode.node_type_settings)
      : nodeProcessor.defaultSettings

    if (nodeProcessor.onUpdate) {
      console.log(`Invoking onUpdate handler for node ${nodeId} of type ${type}`)
      return await nodeProcessor.onUpdate(this, nodeId, oldNode, newNode, settings)
    }
    return null
  }

  async regenerate<T extends Record<string, any> = Record<string, any>>(
    context: RegenerationNodeContext,
    nodeId: number,
  ): Promise<PlanNodeRow> {
    // await sleep(600000)
    let node = this.repo.findById(nodeId)
    if (!node) throw makeErrorWithStatus("node not found", 404)

    node = await this.patch(nodeId, false, { status: "GENERATING" })

    try {
      const nodeProcessor = this.getProcessor(node.type) as NodeProcessor<T>

      let patch: PlanNodeUpdate = {}
      if (nodeProcessor.regenerate) {
        console.debug("[PlanNodeService]", "regenerate", "node.node_type_settings", node.node_type_settings)
        const settings =
          node.node_type_settings !== null
            ? mergeNodeSettings(nodeProcessor.defaultSettings, node.node_type_settings)
            : nodeProcessor.defaultSettings
        console.debug("[PlanNodeService]", "regenerate", "settings", settings)

        patch = (await nodeProcessor.regenerate(this, context, node, settings)) || {}
      }

      const patchedContent = nodeProcessor.getOutput(this, {
        ...node,
        ...patch,
      })

      if (SettingsRepository.getAutoGenerateSummary() && patch.summary === undefined) {
        if (patchedContent) {
          try {
            patch = {
              ...patch,
              summary: (await generateSummary(["plan-node-summary", `${nodeId}`], patchedContent)) || "",
              status: "GENERATED",
            }
          } catch (e) {
            console.error(e)
            patch = {
              ...patch,
              summary: `(error): ${e}`,
              status: "GENERATED",
            }
          }
        } else {
          patch = {
            ...patch,
            summary: null,
            status: "EMPTY",
          }
        }
      } else {
        patch = {
          ...patch,
          summary: patch.summary || null,
          status: patchedContent ? "GENERATED" : "EMPTY",
        }
      }

      return await this.patch(nodeId, false, patch)
    } catch (e) {
      console.error(`Unable to regenerate node ${nodeId}`, e)
      node = await this.patch(nodeId, false, { status: "ERROR" })
      throw e
    }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  delete(id: number) {
    console.log(`Deleting node with id ${id}`)

    const oldNode = this.repo.findById(id)
    if (!oldNode) throw makeErrorWithStatus("node not found", 404)

    // Delete connected edges first
    new PlanEdgeRepository().deleteByNodeId(id)

    // Delete connected edges first (should be handled by foreign key, but we do it explicitly)
    // This is done by the repository's delete method.
    this.repo.delete(id)

    planNodeEventManager.emitUpdate(id)
  }

  async move(id: number, parentId: number | null) {
    const oldNode = this.repo.findById(id)
    if (!oldNode) throw makeErrorWithStatus("node not found", 404)

    // Check if node type is confined (cannot be moved)
    const nodeDef = getNodeTypeDefinition(oldNode.type)
    if (nodeDef?.confined) {
      throw makeErrorWithStatus(`Node type ${oldNode.type} cannot be moved`, 403)
    }

    if (oldNode.parent_id === null) throw makeErrorWithStatus("root node cannot be moved", 403)
    if (parentId === id) throw makeErrorWithStatus("cannot move node to itself", 400)

    if (parentId !== null) {
      const target = this.repo.findById(parentId)
      if (!target) throw makeErrorWithStatus("target parent does not exist", 400)

      // Check for cycles
      let cur: number | null = parentId
      while (cur !== null) {
        if (cur === id) throw makeErrorWithStatus("cannot move node into its own descendant", 400)
        const parent = this.repo.findById(cur)
        cur = parent?.parent_id ?? null
      }
    }

    this.patch(id, true, { parent_id: parentId })
  }

  async reorderChildren(childIds: number[]) {
    if (!Array.isArray(childIds)) throw makeErrorWithStatus("child_ids must be an array", 400)

    childIds.forEach((id, index) => {
      this.patch(id, true, { position: index })
    })
  }

  changeForEachNodePage(nodeId: number, page: number): PlanNodeRow {
    const repo = this.repo
    const node = this.getById(nodeId)
    if (node.type !== "for-each") {
      throw makeErrorWithStatus(`Node ${nodeId} is not a for-each node, but '${node.type}'`, 400)
    }
    const parsedContent = (JSON.parse(node.content || "{}") || {}) as ForEachNodeContent

    console.log(
      `[changeForEachNodePage] node ${nodeId}, currentIndex=${parsedContent.currentIndex}, page=${page}, overrides before save:`,
      parsedContent.overrides,
    )
    // save current page
    parsedContent.overrides = [...(parsedContent.overrides || [])]
    const collected = repo.collectForEachNodeIterationContentFromChildren(nodeId)
    console.log(`[changeForEachNodePage] collected overrides:`, collected)
    console.log(`[changeForEachNodePage] collected keys:`, Object.keys(collected))
    parsedContent.overrides[parsedContent.currentIndex || 0] = collected

    console.log(`[changeForEachNodePage] overrides after save:`, parsedContent.overrides)
    console.log(
      `[changeForEachNodePage] overrides[${parsedContent.currentIndex || 0}] keys:`,
      Object.keys(parsedContent.overrides[parsedContent.currentIndex || 0] || {}),
    )
    repo.applyForEachNodeIterationToChildren(nodeId, parsedContent.overrides[page] || {})

    parsedContent.currentIndex = page
    const result = repo.patch(nodeId, { content: JSON.stringify(parsedContent) })
    console.log(`[changeForEachNodePage] saved content:`, JSON.stringify(parsedContent))

    // Emit events to frontend
    planNodeEventManager.emitUpdate(nodeId, `changed page in ${nodeId}`)
    repo.findByParentId(nodeId).forEach((child) => {
      planNodeEventManager.emitUpdate(child.id, `changed page in ${nodeId}`)
    })

    return result
  }

  private countWords(text: string): number {
    const t = text.trim()
    return t === "" ? 0 : t.split(/\s+/).length
  }

  private countChars(text: string): number {
    return [...text].length
  }

  private countBytes(text: string): number {
    return Buffer.byteLength(text, "utf8")
  }

  async aiGenerateSummary(nodeId: number): Promise<PlanNodeRow> {
    const node = this.getById(nodeId)
    if (!node) throw makeErrorWithStatus(`node ${nodeId} not found`, 404)

    const nodeProcessor = this.getProcessor(node.type) as NodeProcessor
    const nodeContent = nodeProcessor.getOutput(this, node)

    return await this.patch(nodeId, false, {
      summary: nodeContent ? await generateSummary(["plan-node-summary", `${nodeId}`], nodeContent) : "",
    })
  }

  aiImprove(nodeId: number): Observable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>, unknown> {
    const node = this.getById(nodeId)
    if (!node) throw makeErrorWithStatus(`node ${nodeId} not found`, 404)

    return toObservable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>>(async (emit) => {
      const { oldNode, newContent } = await improvePlanNodeContent(nodeId, (event) => {
        emit.next({ type: "event", event })
      })

      const newNode = await this.patch(nodeId, true, {
        status: "MANUAL",
        content: newContent,
        in_review: (oldNode.content?.trim?.()?.length || 0) > 0 ? 1 : 0,
        review_base_content: oldNode.content,
      })

      emit.next({ type: "data", data: newNode })
      emit.next({ type: "completed" })
    })
  }

  async saveContentToFile(nodeId: number, filePath: string): Promise<void> {
    const node = this.getById(nodeId)
    if (!node) throw makeErrorWithStatus(`node ${nodeId} not found`, 404)

    await fs.writeFile(filePath, node.content || "", "utf8")
  }
}

export interface PlanNodeSubscriptionEvent {
  event: ResponseStreamEvent
}
