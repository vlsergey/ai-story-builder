import type { PlanNodeCreate, PlanNodeUpdate, PlanNodeType, PlanNodeRow, PlanNodeStatus } from '../../../shared/plan-graph.js'
import { PlanNodeRepository } from './plan-node-repository.js'
import { generateMergeContent } from '../../routes/merge-node.js'
import { isValidNodeType } from '../../../shared/node-edge-dictionary.js'

export type NodeUpdateEvent = {
  nodeId: number
  updatedFields: Partial<PlanNodeRow>
}

/**
 * Service for plan node operations.
 * Encapsulates business logic and emits events on changes.
 */
export class PlanNodeService {
  private readonly repo: PlanNodeRepository

  constructor(
    private readonly onNodeUpdated?: (event: NodeUpdateEvent) => void
  ) {
    this.repo = new PlanNodeRepository()
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

    this.emitNodeUpdated(id, {
      id,
      parent_id: data.parent_id ?? null,
      title: data.title,
      type: type,
      status,
    })

    return { id }
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  /**
   * Update node content and optionally status.
   * If content is provided, word/char/byte counts are recalculated.
   */
  updateContent(
    id: number,
    content: string | null,
    options?: {
      status?: PlanNodeStatus
      wordCount?: number
      charCount?: number
      byteCount?: number
    }
  ): void {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

    this.repo.updateContent(id, content, options)

    const updatedFields: Partial<PlanNodeRow> = { content }
    if (options?.status) updatedFields.status = options.status
    if (options?.wordCount !== undefined) updatedFields.word_count = options.wordCount
    if (options?.charCount !== undefined) updatedFields.char_count = options.charCount
    if (options?.byteCount !== undefined) updatedFields.byte_count = options.byteCount

    this.emitNodeUpdated(id, updatedFields)
  }

  /**
   * Update node status only.
   */
  updateStatus(id: number, status: PlanNodeStatus): void {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

    this.repo.updateStatus(id, status)
    this.emitNodeUpdated(id, { status })
  }

  /**
   * Start a review for a node, optionally updating content and setting the improve instruction.
   * If content is provided, it will replace the current content.
   * Sets changes_status = 'review' and stores review_base_content if not already in review.
   */
  startReview(
    id: number,
    options?: {
      prompt?: string
      content?: string
    }
  ): void {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

    const updateFields: PlanNodeUpdate = {}
    if (options?.prompt !== undefined) {
      updateFields.last_improve_instruction = options.prompt ?? null
    }
    if (options?.content !== undefined) {
      updateFields.content = options.content
      updateFields.word_count = this.countWords(options.content)
      updateFields.char_count = this.countChars(options.content)
      updateFields.byte_count = this.countBytes(options.content)
    }
    updateFields.changes_status = 'review'
    if (oldNode.changes_status !== 'review') {
      updateFields.review_base_content = oldNode.content ?? ''
    }

    this.repo.update(id, updateFields)
    this.emitNodeUpdated(id, updateFields)
  }

  /**
   * Accept the current review, clearing review state.
   */
  acceptReview(id: number): void {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

    const updateFields: Partial<PlanNodeRow> = {
      changes_status: null,
      review_base_content: null,
      last_improve_instruction: null,
    }
    this.repo.update(id, updateFields)
    this.emitNodeUpdated(id, updateFields)
  }

  /**
   * Update multiple fields of a node (generic patch).
   * Handles merge node regeneration if needed.
   */
  patch(
    id: number,
    data: PlanNodeUpdate
  ): { ok: boolean; word_count?: number | null; char_count?: number | null; byte_count?: number | null } {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

    const hasTitle = typeof data.title === 'string' && data.title.trim().length > 0
    const hasContent = data.content !== undefined
    const hasType = data.type !== undefined
    const hasNodeTypeSettings = data.node_type_settings !== undefined
    const willBeMerge = (hasType && data.type === 'merge') || (!hasType && oldNode.type === 'merge')

    // Validate type if provided
    if (hasType && !isValidNodeType(data.type!)) {
      const valid = ['text', 'lore', 'merge', 'split'].join(', ')
      throw this.makeError(`Invalid node type "${data.type}". Valid types: ${valid}`, 400)
    }

    // Determine if we should regenerate merge content
    let generatedContent: string | null = null
    let generatedWordCount: number | null = null
    let generatedCharCount: number | null = null
    let generatedByteCount: number | null = null

    if (willBeMerge && !hasContent && (hasNodeTypeSettings || (hasType && data.type === 'merge'))) {
      const defaultSettings = {
        includeNodeTitle: false,
        includeInputTitles: false,
        fixHeaders: false,
        autoUpdate: false,
      }
      let settings = defaultSettings
      if (hasNodeTypeSettings) {
        try {
          settings = { ...defaultSettings, ...JSON.parse(data.node_type_settings!) }
        } catch (_) {
          // keep defaults
        }
      } else if (oldNode.node_type_settings) {
        try {
          settings = { ...defaultSettings, ...JSON.parse(oldNode.node_type_settings) }
        } catch (_) {
          // keep defaults
        }
      }
      const nodeTitle = hasTitle ? data.title!.trim() : oldNode.title
      try {
        generatedContent = generateMergeContent(id, settings, nodeTitle)
        generatedWordCount = this.countWords(generatedContent)
        generatedCharCount = this.countChars(generatedContent)
        generatedByteCount = this.countBytes(generatedContent)
      } catch (_) {
        // If generation fails (e.g., no inputs), leave content empty
        generatedContent = ''
        generatedWordCount = 0
        generatedCharCount = 0
        generatedByteCount = 0
      }
    }

    // Determine new status
    let newStatus = oldNode.status
    if (generatedContent !== null) {
      newStatus = 'GENERATED'
    } else if (hasContent) {
      const content = data.content!
      if (content === null || content.trim() === '') {
        newStatus = 'EMPTY'
      } else {
        newStatus = 'MANUAL'
      }
    }

    // Build update fields
    const updateFields: Partial<PlanNodeRow> = {}
    if (hasTitle) updateFields.title = data.title!.trim()
    if (hasType) updateFields.type = data.type! as PlanNodeType
    if (data.x !== undefined) updateFields.x = data.x
    if (data.y !== undefined) updateFields.y = data.y
    if (data.ai_instructions !== undefined) updateFields.ai_instructions = data.ai_instructions ?? null
    if (data.summary !== undefined) updateFields.summary = data.summary ?? null
    if (data.auto_summary !== undefined) updateFields.auto_summary = data.auto_summary ?? 0
    if (hasNodeTypeSettings) updateFields.node_type_settings = data.node_type_settings ?? null
    if (newStatus !== oldNode.status) updateFields.status = newStatus

    // Add generated merge content if any
    if (generatedContent !== null) {
      updateFields.content = generatedContent
      updateFields.word_count = generatedWordCount!
      updateFields.char_count = generatedCharCount!
      updateFields.byte_count = generatedByteCount!
    }

    // Handle content update (user-provided)
    let wordCount: number | null = null
    let charCount: number | null = null
    let byteCount: number | null = null
    if (hasContent) {
      updateFields.content = data.content!
      wordCount = this.countWords(data.content!)
      charCount = this.countChars(data.content!)
      byteCount = this.countBytes(data.content!)
      updateFields.word_count = wordCount
      updateFields.char_count = charCount
      updateFields.byte_count = byteCount
    }

    // Handle fields that are part of PlanNodeInsert
    if (data.ai_settings !== undefined) updateFields.ai_settings = data.ai_settings ?? null
    if (data.last_improve_instruction !== undefined) updateFields.last_improve_instruction = data.last_improve_instruction ?? null
    if (data.changes_status !== undefined) updateFields.changes_status = data.changes_status ?? null
    if (data.review_base_content !== undefined) updateFields.review_base_content = data.review_base_content ?? null

    // Apply update
    const changes = this.repo.update(id, updateFields)
    if (changes === 0) {
      // No fields changed (should not happen)
      return { ok: true }
    }

    // Emit event
    this.emitNodeUpdated(id, updateFields)

    const anyContent = hasContent || generatedContent !== null
    const finalWordCount = hasContent ? wordCount : (generatedContent !== null ? generatedWordCount : null)
    const finalCharCount = hasContent ? charCount : (generatedContent !== null ? generatedCharCount : null)
    const finalByteCount = hasContent ? byteCount : (generatedContent !== null ? generatedByteCount : null)

    return anyContent
      ? { ok: true, word_count: finalWordCount, char_count: finalCharCount, byte_count: finalByteCount }
      : { ok: true }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  delete(id: number): { ok: boolean } {
    const oldNode = this.repo.getById(id)
    if (!oldNode) throw this.makeError('node not found', 404)

    // Delete connected edges first (should be handled by foreign key, but we do it explicitly)
    // This is done by the repository's delete method.
    this.repo.delete(id)

    // Emit event? The node is gone, maybe we need a 'node_deleted' event.
    // For now, we'll not emit.

    return { ok: true }
  }

  // ─── Move & Reorder ──────────────────────────────────────────────────────────

  move(id: number, parentId: number | null): { ok: boolean } {
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

    this.repo.updateParent(id, parentId)
    this.emitNodeUpdated(id, { parent_id: parentId })
    return { ok: true }
  }

  reorderChildren(childIds: number[]): { ok: boolean } {
    if (!Array.isArray(childIds)) throw this.makeError('child_ids must be an array', 400)

    // Update positions in transaction (repository doesn't support transaction yet)
    // For simplicity, we'll call updatePosition for each.
    childIds.forEach((id, index) => {
      this.repo.updatePosition(id, index)
    })

    // Emit events for each node? Could batch.
    childIds.forEach(id => {
      this.emitNodeUpdated(id, { position: childIds.indexOf(id) })
    })

    return { ok: true }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private emitNodeUpdated(nodeId: number, updatedFields: Partial<PlanNodeRow>): void {
    if (this.onNodeUpdated) {
      this.onNodeUpdated({ nodeId, updatedFields })
    }
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
}