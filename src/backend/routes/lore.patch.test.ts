/**
 * Integration tests for patchLoreNode()
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { migrateDatabase } from '../db/migrations.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'

let testDbPath = ''

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => testDbPath,
  getDataDir: () => os.tmpdir(),
}))

const { patchLoreNode } = await import('./lore.js')

function setupDb(): string {
  const file = path.join(
    os.tmpdir(),
    `lore_patch_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file)
  migrateDatabase(db)
  db.close()

  const prev = testDbPath
  testDbPath = file
  const repo = new LoreNodeRepository()
  repo.insert({ id: 1, parent_id: null, name: 'root', content: null })
  repo.insert({ id: 2, parent_id: 1, name: 'chapter', content: null })
  testDbPath = prev
  return file
}

beforeEach(() => { testDbPath = setupDb() })
afterEach(() => { try { fs.unlinkSync(testDbPath) } catch { /* ignore */ } })

describe('patchLoreNode', () => {
  it('returns updated word/char/byte counts when content is saved', () => {
    const res = patchLoreNode(2, { content: 'Hello world from lore' })

    expect(res.ok).toBe(true)
    expect(res.word_count).toBe(4)
    expect(res.char_count).toBe(21)
    expect(res.byte_count).toBe(21)
  })

  it('does not include stats in response when only name is updated', () => {
    const res = patchLoreNode(2, { name: 'New Name' })

    expect(res.ok).toBe(true)
    expect(res.word_count).toBeUndefined()
  })

  it('returns null ai_sync_info when node has no prior sync records', () => {
    const res = patchLoreNode(2, { content: 'Some new content' })

    expect(res.ok).toBe(true)
    expect(res.ai_sync_info).toBeNull()
  })

  it('returns updated ai_sync_info with content_updated_at when node has existing sync records', () => {
    const repo = new LoreNodeRepository()
    repo.updateAiSyncInfo(2, JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'f1' } }))

    const before = new Date().toISOString()
    const res = patchLoreNode(2, { content: 'Updated content' })

    expect(res.ok).toBe(true)
    expect(res.ai_sync_info).toBeDefined()
    expect(res.ai_sync_info!.yandex).toBeDefined()
    expect(res.ai_sync_info!.yandex.file_id).toBe('f1')
    expect(res.ai_sync_info!.yandex.content_updated_at).toBeDefined()
    expect(new Date(res.ai_sync_info!.yandex.content_updated_at as string).getTime())
      .toBeGreaterThanOrEqual(new Date(before).getTime() - 1000)
  })

  it('does not return ai_sync_info when only name is updated', () => {
    const res = patchLoreNode(2, { name: 'New Name' })

    expect(res.ok).toBe(true)
    expect(res.ai_sync_info).toBeUndefined()
  })

  it('persists updated content_updated_at inside ai_sync_info in DB when content is saved', () => {
    const repo = new LoreNodeRepository()
    repo.updateAiSyncInfo(2, JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'f1' } }))

    patchLoreNode(2, { content: 'Some content' })

    const node = repo.getById(2)
    expect(node).toBeDefined()
    const syncInfo = JSON.parse(node!.ai_sync_info!) as { yandex: { content_updated_at?: string } }
    expect(syncInfo.yandex.content_updated_at).toBeDefined()
  })

  it('start_review captures current content as review_base_content and sets changes_status=review', () => {
    const repo = new LoreNodeRepository()
    repo.update(2, { content: 'Original content' })

    const res = patchLoreNode(2, { content: 'AI improved content', prompt: 'Make it better', start_review: true })

    expect(res.ok).toBe(true)

    const node = repo.getById(2)
    expect(node!.content).toBe('AI improved content')
    expect(node!.changes_status).toBe('review')
    expect(node!.review_base_content).toBe('Original content')
  })

  it('start_review saves prompt as last_improve_instruction', () => {
    patchLoreNode(2, { content: 'New content', prompt: 'Make it epic', start_review: true })

    const repo = new LoreNodeRepository()
    const node = repo.getById(2)
    expect(node!.last_improve_instruction).toBe('Make it epic')
  })

  it('start_review does not overwrite review_base_content when already in review', () => {
    const repo = new LoreNodeRepository()
    repo.update(2, { content: 'First AI result', changes_status: 'review', review_base_content: 'Original content' })

    patchLoreNode(2, { content: 'Second AI result', start_review: true })

    const node = repo.getById(2)
    expect(node!.review_base_content).toBe('Original content')
  })

  it('accept_review clears changes_status, review_base_content, and last_improve_instruction', () => {
    const repo = new LoreNodeRepository()
    repo.update(2, { changes_status: 'review', review_base_content: 'Old', last_improve_instruction: 'some instruction' })

    const res = patchLoreNode(2, { accept_review: true })

    expect(res.ok).toBe(true)

    const node = repo.getById(2)
    expect(node!.changes_status).toBeNull()
    expect(node!.review_base_content).toBeNull()
    expect(node!.last_improve_instruction).toBeNull()
  })
})
