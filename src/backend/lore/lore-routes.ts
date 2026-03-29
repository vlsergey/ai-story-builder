import fs from 'fs'
import type { LoreTreeNode } from '../types/index.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'
import { LoreNodeRow } from '../../shared/lore-node.js';
import { loreEventManager } from './lore-event-manager.js'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

// ── Content stats helpers ─────────────────────────────────────────────────────

function countWords(text: string): number {
  const t = text.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

function countChars(text: string): number {
  return [...text].length  // Unicode code points
}

function countBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

// ── Tree ──────────────────────────────────────────────────────────────────────

export function getLoreTree(): LoreTreeNode[] {
  const repo = new LoreNodeRepository()
  const rows = repo.getAll()
  const map = new Map<number, LoreTreeNode>()
  rows.forEach(r => map.set(r.id, {
    ...r,
    ai_sync_info: r.ai_sync_info ? JSON.parse(r.ai_sync_info) : null,
    children: [],
  }))
  const roots: LoreTreeNode[] = []
  for (const node of map.values()) {
    if (node.parent_id != null && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// ── Import ─────────────────────────────────────────────────────────────────────

export function importLoreNode(data: { title: string; content: string; parentId: number }): { id: number | bigint } {
  const { title, content, parentId } = data
  const wordCount = countWords(content)
  const charCount = countChars(content)
  const byteCount = countBytes(content)
  const repo = new LoreNodeRepository()
  const id = repo.insert({
    parent_id: parentId,
    title,
    content,
    word_count: wordCount,
    char_count: charCount,
    byte_count: byteCount,
  })
  loreEventManager.emitUpdate(Number(id))
  return { id }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createLoreNode(data: { parent_id?: number | null; name: string }): { id: number } {
  const { parent_id, name: title } = data
  if (!title?.trim()) throw makeError('name required', 400)
  const repo = new LoreNodeRepository()
  const pid = parent_id ?? null
  const maxPos = repo.getMaxPosition(pid)
  const id = repo.insert({
    parent_id: pid,
    title: title.trim(),
    position: maxPos + 1,
  })
  loreEventManager.emitUpdate(id)
  return { id }
}

export function reorderLoreChildren(child_ids: number[]): { ok: boolean } {
  if (!Array.isArray(child_ids)) throw makeError('child_ids must be an array', 400)
  const repo = new LoreNodeRepository()
  repo.reorderChildren(child_ids)
  child_ids.forEach(id => loreEventManager.emitUpdate(id))
  return { ok: true }
}

export function getLoreNode(id: number): LoreNodeRow {
  const repo = new LoreNodeRepository()
  const node = repo.getById(id)
  if (!node) throw makeError('node not found', 404)
  return node
}

export function patchLoreNode(
  id: number,
  data: {
    title?: string
    content?: string
    start_review?: boolean
    accept_review?: boolean
    ai_user_prompt?: string | null
    ai_system_prompt?: string | null
    ai_settings?: string | null
  }
): {
  ok: boolean
  word_count?: number | null
  char_count?: number | null
  byte_count?: number | null
  ai_sync_info?: Record<string, Record<string, unknown>> | null
} {
  const { title: title, content, start_review, accept_review, ai_user_prompt, ai_system_prompt, ai_settings } = data
  const hasName = typeof title === 'string' && title.trim().length > 0
  const hasContent = content !== undefined
  const hasAiUserPrompt = ai_user_prompt !== undefined
  const hasAiSystemPrompt = ai_system_prompt !== undefined
  const hasAiSettings = ai_settings !== undefined
  const hasStartReview = start_review === true
  const hasAcceptReview = accept_review === true
  if (!hasName && !hasContent && !hasAiUserPrompt && !hasAiSystemPrompt && !hasAiSettings && !hasStartReview && !hasAcceptReview) {
    throw makeError('title or content required', 400)
  }

  const repo = new LoreNodeRepository()
  const node = repo.getById(id)
  if (!node) throw makeError('node not found', 404)

  const updates: Partial<LoreNodeRow> = {}
  if (hasName) updates.title = title.trim()
  let wordCount: number | null = null
  let charCount: number | null = null
  let byteCount: number | null = null
  let updatedSyncInfo: Record<string, Record<string, unknown>> | null = null
  if (hasContent) {
    wordCount = countWords(content)
    charCount = countChars(content)
    byteCount = countBytes(content)
    updates.content = content
    updates.word_count = wordCount
    updates.char_count = charCount
    updates.byte_count = byteCount
    if (node.ai_sync_info) {
      try {
        const syncInfo = JSON.parse(node.ai_sync_info) as Record<string, Record<string, unknown>>
        const now = new Date().toISOString()
        for (const engine of Object.keys(syncInfo)) {
          syncInfo[engine] = { ...syncInfo[engine], content_updated_at: now }
        }
        updates.ai_sync_info = JSON.stringify(syncInfo)
        updatedSyncInfo = syncInfo
      } catch { /* ignore malformed JSON */ }
    }
  }

  if (hasAiUserPrompt) {
    updates.ai_user_prompt = ai_user_prompt ?? null
  }

  if (hasAiSystemPrompt) {
    updates.ai_system_prompt = ai_system_prompt ?? null
  }

  if (hasAiSettings) {
    updates.ai_settings = ai_settings ?? null
  }

  if (hasAiUserPrompt && !start_review) {
    updates.ai_improve_instruction = ai_user_prompt ?? null
  }

  if (start_review && hasContent) {
    updates.in_review = 1
    updates.ai_improve_instruction = ai_user_prompt ?? null
    if (node.in_review !== 1) {
      updates.review_base_content = node.content ?? ''
    }
  }

  if (accept_review) {
    updates.in_review = 0
    updates.review_base_content = null
    updates.ai_improve_instruction = null
  }

  if (Object.keys(updates).length > 0) {
    repo.update(id, updates)
    loreEventManager.emitUpdate(id)
  }

  return hasContent
    ? { ok: true, word_count: wordCount, char_count: charCount, byte_count: byteCount, ai_sync_info: updatedSyncInfo }
    : { ok: true }
}

export function deleteLoreNode(id: number): { ok: boolean } {
  const repo = new LoreNodeRepository()
  const node = repo.getById(id)
  if (!node) throw makeError('node not found', 404)
  if (node.parent_id === null) throw makeError('root node cannot be deleted', 403)
  repo.markForDeletionRecursive(id)
  loreEventManager.emitUpdate(id)
  return { ok: true }
}

export function restoreLoreNode(id: number): { ok: boolean } {
  const repo = new LoreNodeRepository()
  repo.restoreRecursive(id)
  loreEventManager.emitUpdate(id)
  return { ok: true }
}

export function sortLoreChildren(id: number): { ok: boolean; sorted: number } {
  const repo = new LoreNodeRepository()
  const sorted = repo.sortChildrenByName(id)
  loreEventManager.emitUpdate(id)
  return { ok: true, sorted }
}

export function moveLoreNode(id: number, data: { parent_id?: number | null }): { ok: boolean } {
  const { parent_id } = data
  const repo = new LoreNodeRepository()
  const nodeId = Number(id)
  const newParentId = parent_id ?? null

  const node = repo.getNodeInfo(nodeId)
  if (!node) throw makeError('node not found', 404)
  if (node.parent_id === null) throw makeError('root node cannot be moved', 403)

  if (newParentId === nodeId) throw makeError('cannot move node to itself', 400)

  if (newParentId !== null) {
    const target = repo.getNodeInfo(newParentId)
    if (!target) throw makeError('target parent does not exist', 400)
    if (target.to_be_deleted && !node.to_be_deleted) {
      throw makeError('cannot move active node into a node marked for deletion', 400)
    }
  }

  if (newParentId !== null) {
    const parentChain = repo.getParentChain(newParentId)
    if (parentChain.includes(nodeId)) {
      throw makeError('cannot move node into its own descendant', 400)
    }
  }

  repo.updateParent(nodeId, newParentId)
  loreEventManager.emitUpdate(nodeId)
  return { ok: true }
}

export function duplicateLoreNode(id: number): { id: number | bigint } {
  const repo = new LoreNodeRepository()
  const newId = repo.duplicate(id)
  loreEventManager.emitUpdate(Number(newId))
  return { id: newId }
}

// Keep fs import used only by older callers; unused here but kept for compat
void fs
