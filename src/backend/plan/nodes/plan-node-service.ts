import type { PlanNodeCreate, PlanNodeUpdate, PlanNodeType, PlanNodeRow, PlanNodeStatus, PlanEdgeType } from '../../../shared/plan-graph.js'
import { PlanNodeRepository } from './plan-node-repository.js'
import { PlanEdgeRepository } from '../edges/plan-edge-repository.js'
import { isValidNodeType } from '../../../shared/node-edge-dictionary.js'
import { planNodeEventManager } from './plan-node-event-manager.js'
import { NodeProcessor, NodeProcessorRegistry } from './graph/node-processor.js'
import { TextProcessor } from './graph/text-processor.js'
import { LoreProcessor } from './graph/lore-processor.js'
import { SplitProcessor } from './graph/split-processor.js'
import { MergeProcessor } from './graph/merge-processor.js'
import type { NodeContext } from './graph/node-interfaces.js'
import { mergeNodeSettings } from './graph/settings-helper.js'
import { DataOrEventEvent, toObservable } from '../../lib/event-manager.js'
import { improvePlanNodeContent } from '../../routes/improve-plan-node-content.js'
import { ResponseStreamEvent } from 'openai/resources/responses/responses.js'
import { generatePlanNodeTextContent } from '../../routes/generate-plan-node-text-content.js'
import { Observable } from '@trpc/server/observable'
import { generateSummary } from '../../routes/generate-summary.js'

export type NodeUpdateEvent = {
  nodeId: number
  updatedFields: Partial<PlanNodeRow>
}

/**
 * Service for plan node operations.
 * Encapsulates business logic and emits events on changes.
 */
export class PlanNodeService implements NodeContext {
  private readonly repo: PlanNodeRepository
  private readonly processorRegistry: NodeProcessorRegistry

  constructor() {
    this.repo = new PlanNodeRepository()
    this.processorRegistry = new NodeProcessorRegistry()

    this.processorRegistry.register(new TextProcessor())
    this.processorRegistry.register(new LoreProcessor())
    this.processorRegistry.register(new SplitProcessor())
    this.processorRegistry.register(new MergeProcessor())
  }

  // ─── Basic CRUD ──────────────────────────────────────────────────────────────

  getAll(): PlanNodeRow[] {
    return this.repo.getAll()
  }

  getById(id: number): PlanNodeRow | undefined {
    return this.repo.getById(id)
  }

  getByParentId(parentId: number | null): PlanNodeRow[] {
    return this.repo.getByParentId(parentId)
  }

  count(): number {
    return this.repo.count()
  }

  getIncomingEdges(nodeId: number): Array<{ from_node_id: number; type: PlanEdgeType }> {
    const edgeRepo = new PlanEdgeRepository()
    const edges = edgeRepo.getByToNodeId(nodeId)
    return edges.map(edge => ({ from_node_id: edge.from_node_id, type: edge.type }))
  }

  getOutgoingEdges(nodeId: number): Array<{ to_node_id: number; type: PlanEdgeType }> {
    const edgeRepo = new PlanEdgeRepository()
    const edges = edgeRepo.getByFromNodeId(nodeId)
    return edges.map(edge => ({ to_node_id: edge.to_node_id, type: edge.type }))
  }

  getProcessor(nodeType: PlanNodeType) {
    return this.processorRegistry.getProcessor(nodeType)
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

  getNodeInputsRaw(nodeId: number): Array<{
    edgeType: PlanEdgeType
    sourceNodeId: number
    output: unknown
  }> {
    const edges = this.getIncomingEdges(nodeId)
    const inputs = []
    for (const edge of edges) {
      const sourceNode = this.getById(edge.from_node_id)
      if (!sourceNode) continue
      const processor = this.getProcessor(sourceNode.type)
      if (!processor) continue
      const output = processor.getOutput(sourceNode)
      // Verify that the edge type matches the processor's output edge type
      if (processor.getOutputEdgeType() !== edge.type) {
        // This edge is not the output type of the source node, skip
        continue
      }
      inputs.push({
        edgeType: edge.type,
        sourceNodeId: edge.from_node_id,
        output,
      })
    }
    // Sort by edge position? (not implemented)
    return inputs
  }

  getNodeOutput(nodeId: number, edgeType: PlanEdgeType): unknown {
    const node = this.getById(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    const processor = this.getProcessor(node.type)
    if (!processor) throw new Error(`No processor for node type ${node.type}`)
    const output = processor.getOutput(node)
    // Verify that the requested edge type matches the processor's output edge type
    if (processor.getOutputEdgeType() !== edgeType) {
      throw new Error(`Node ${nodeId} does not produce edge type ${edgeType}`)
    }
    return output
  }

  /**
   * Notify all downstream nodes that a node's content has changed.
   * This calls each downstream node's onInputContentChange method (if defined).
   * If the processor returns updated PlanNodeRow, the node will be updated (if content changed)
   * and downstream notifications will propagate further.
   */
  async notifyDownstreamNodes(changedNodeId: number): Promise<void> {
    const outgoingEdges = this.getOutgoingEdges(changedNodeId)
    for (const edge of outgoingEdges) {
      const downstreamNode = this.getById(edge.to_node_id)
      if (!downstreamNode) continue
      const processor = this.getProcessor(downstreamNode.type)
      if (processor?.onInputContentChange) {
        const settings = this.getNodeSettings(downstreamNode)
        const planNodeUpdate = await processor.onInputContentChange(this, downstreamNode, changedNodeId, settings)
        if (planNodeUpdate) {
          await this.patch( downstreamNode.id, false, planNodeUpdate )
        }
      }
    }
  }

  // ─── Create ──────────────────────────────────────────────────────────────────

  create(data: PlanNodeCreate): { id: number } {
    // Validate node type
    const type = data.type ?? 'text'
    if (!isValidNodeType(type)) {
      const valid = ['text', 'lore', 'merge', 'split'].join(', ')
      throw this.makeError(`Invalid node type "${type}". Valid types: ${valid}`, 400)
    }

    // Determine status based on content
    let status: PlanNodeStatus = 'EMPTY'
    let wordCount = 0, charCount = 0, byteCount = 0
    if (data.content && data.content.trim() !== '') {
      status = 'MANUAL'
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

    planNodeEventManager.emitUpdate(id)
    return { id }
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  /**
   * Start a review for a node, optionally updating content and setting the improve instruction.
   * If content is provided, it will replace the current content.
   * Sets changes_status = 'review' and stores review_base_content if not already in review.
   */
  async startReview(
    id: number,
    patch?: PlanNodeUpdate
  ) : Promise<PlanNodeRow> {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

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
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

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
    let oldNode = this.repo.getById(nodeId)
    if (!oldNode) throw this.makeError('node not found', 404)

    let update = {...data}

    if (data.status !== undefined) {
      console.log("In patch there is a requirement to change status to " + data.status + "")
    } else {
      if (update.content !== undefined) {
        if (!update.content) {
          console.log("Status will be changed to EMPTY because content is empty")
          update.status = 'EMPTY'
        } else {
          if (manual) {
            console.log("Status will be changed to MANUAL because content is not empty and manual is true")
            update.status = 'MANUAL'
          } else {
            console.log("Status will be changed to GENERATED because content is not empty and manual is false")
            update.status = 'GENERATED'
          }
        }
      }
    }

    update = {
      ...update,
      ...(await this.mayBeInvokeOnUpdate(nodeId, oldNode, {...oldNode, ...update}))
    }

    const updated = Object.keys(update).length != 0
      ? this.repo.patch(nodeId, update)
      : oldNode
    if (!updated) throw this.makeError('node not found', 404)

    // Emit event to frontend
    planNodeEventManager.emitUpdate(nodeId, 'patched keys: ' + Object.keys(data).join(', ') + '')

    // If content changed, notify downstream nodes
    if (update.content !== undefined) {
      await this.notifyDownstreamNodes(nodeId)
    }

    return updated
  }

  private async mayBeInvokeOnUpdate<
    N extends (PlanNodeRow | null) = PlanNodeRow,
    T extends Record<string, any> = Record<string, any>
  >(
    nodeId: number,
    oldNode: PlanNodeRow | null,
    newNode: N,
  ): Promise<PlanNodeUpdate | null> {
    const type = oldNode?.type ?? newNode?.type
    if (!type) return null

    const nodeProcessor = this.processorRegistry.getProcessor(type) as NodeProcessor<T>
    const {defaultSettings, onUpdate} = nodeProcessor

    const settings = newNode?.node_type_settings
      ? mergeNodeSettings(defaultSettings, newNode.node_type_settings)
      : defaultSettings

    if (onUpdate) {
      return await onUpdate(this, nodeId, oldNode, newNode, settings)
    }
    return null
  }

  async regenerate<T extends Record<string, any> = Record<string, any>>(nodeId: number): Promise<PlanNodeRow> {
    const node = this.repo.getById(nodeId)
    if (!node) throw this.makeError('node not found', 404)

    const nodeProcessor = this.processorRegistry.getProcessor(node.type) as NodeProcessor<T>
    const {defaultSettings, regenerate} = nodeProcessor
    if (!regenerate)
      throw this.makeError('regenerate not supported by node type ' + node.type, 400)

    const settings = node.node_type_settings
      ? mergeNodeSettings(defaultSettings, node.node_type_settings)
      : defaultSettings    

    const patch = await regenerate(this, node, settings)
    if (!patch) return node
    return await this.patch(nodeId, false, patch)
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  delete(id: number) {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

    // Delete connected edges first
    new PlanEdgeRepository().deleteByNodeId(id)

    // Emit event before deletion so subscribers know the node is being removed
    planNodeEventManager.emitUpdate(id)

    // Delete connected edges first (should be handled by foreign key, but we do it explicitly)
    // This is done by the repository's delete method.
    this.repo.delete(id)

    return { ok: true }
  }

  async move(id: number, parentId: number | null) {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)
    if (oldNode.parent_id === null) throw this.makeError('root node cannot be moved', 403)
    if (parentId === id) throw this.makeError('cannot move node to itself', 400)

    if (parentId !== null) {
      const target = this.repo.getById(parentId)
      if (!target) throw this.makeError('target parent does not exist', 400)

      // Check for cycles
      let cur: number | null = parentId
      while (cur !== null) {
        if (cur === id) throw this.makeError('cannot move node into its own descendant', 400)
        const parent = this.repo.getById(cur)
        cur = parent?.parent_id ?? null
      }
    }

    this.patch(id, true, { parent_id: parentId })
  }

  async reorderChildren(childIds: number[]) {
    if (!Array.isArray(childIds)) throw this.makeError('child_ids must be an array', 400)

    childIds.forEach((id, index) => {
      this.patch(id, true, { position: index })
    })
  }

  private makeError(message: string, status: number): Error {
    const e = new Error(message)
    ;(e as any).status = status
    return e
  }

  private countWords(text: string): number {
    const t = text.trim()
    return t === '' ? 0 : t.split(/\s+/).length
  }

  private countChars(text: string): number {
    return [...text].length
  }

  private countBytes(text: string): number {
    return Buffer.byteLength(text, 'utf8')
  }

  aiGenerate(nodeId: number): Observable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>, unknown> {
    const node = this.getById(nodeId);
    if (!node) throw this.makeError(`node ${nodeId} not found`, 404);

    return toObservable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>>(async (emit) => {
      const newContent = await generatePlanNodeTextContent(node, (event) => {
        emit.next({ type: 'event', event });
      });

      const newNode = await this.patch(nodeId, false, {
        status: 'GENERATED',
        content: newContent,
        in_review: (newContent?.trim()?.length || 0) > 0 ? 1 : 0,
        review_base_content: node.content,
      });

      emit.next({ type: 'data', data: newNode });      
      emit.next({ type: 'completed' });
    });
  }

  async aiGenerateSummary(nodeId: number): Promise<PlanNodeRow> {
    const node = this.getById(nodeId);
    if (!node) throw this.makeError(`node ${nodeId} not found`, 404);

    return await this.patch(nodeId, false, {
      summary: node.content
        ? await generateSummary(node.content)
        : '',
    });
  }

  aiImprove(nodeId: number): Observable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>, unknown> {
    const node = this.getById(nodeId);
    if (!node) throw this.makeError(`node ${nodeId} not found`, 404);

    return toObservable<DataOrEventEvent<PlanNodeRow, ResponseStreamEvent>>(async (emit) => {
      const { oldNode, newContent } = await improvePlanNodeContent(nodeId, (event) => {
        emit.next({ type: 'event', event });
      });

      const newNode = await this.patch(nodeId, true, {
        status: 'MANUAL',
        content: newContent,
        in_review: ((oldNode.content?.trim?.()?.length || 0) > 0) ? 1 : 0,
        review_base_content: oldNode.content,
      });

      emit.next({ type: 'data', data: newNode });      
      emit.next({ type: 'completed' });
    });
  }
}

export interface PlanNodeSubscriptionEvent {
  
  event: ResponseStreamEvent,

}