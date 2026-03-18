/**
 * Integration tests for syncLore()
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { migrateDatabase } from '../db/migrations.js'

let testDbPath = ''

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => testDbPath,
  getDataDir: () => os.tmpdir(),
}))

// ─── OpenAI mock ──────────────────────────────────────────────────────────────

const { mockFilesCreate, mockFilesDel, mockFilesRetrieve, mockVsCreate, mockVsDel, mockVsRetrieve, mockToFile } = vi.hoisted(() => ({
  mockFilesCreate: vi.fn(),
  mockFilesDel: vi.fn(),
  mockFilesRetrieve: vi.fn(),
  mockVsCreate: vi.fn(),
  mockVsDel: vi.fn(),
  mockVsRetrieve: vi.fn(),
  mockToFile: vi.fn(async () => ({})),
}))

vi.mock('openai', () => ({
  default: class {
    files = { create: mockFilesCreate, delete: mockFilesDel, retrieve: mockFilesRetrieve }
    vectorStores = { create: mockVsCreate, delete: mockVsDel, retrieve: mockVsRetrieve }
  },
  toFile: mockToFile,
}))

// ─── Import pure function ─────────────────────────────────────────────────────

const { syncLore, POLL_CONFIG } = await import('./ai-sync.js')

// ─── DB helper ────────────────────────────────────────────────────────────────

function setupDb(opts?: {
  apiKey?: string
  folderId?: string
  searchIndexId?: string
  currentEngine?: string
  grokApiKey?: string
  nodes?: Array<{
    id?: number
    parent_id?: number | null
    name: string
    content?: string | null
    word_count?: number
    to_be_deleted?: number
    ai_sync_info?: string | null
  }>
}): string {
  const file = path.join(
    os.tmpdir(),
    `ai_sync_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file)
  migrateDatabase(db)

  const currentEngine = opts?.currentEngine
    ?? (opts?.grokApiKey ? 'grok' : opts?.apiKey || opts?.folderId ? 'yandex' : undefined)
  if (currentEngine) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('current_backend', ?)").run(currentEngine)
  }

  const aiConfig: Record<string, unknown> = {}
  if (opts?.apiKey || opts?.folderId) {
    const yandex: Record<string, string> = {}
    if (opts.apiKey) yandex['api_key'] = opts.apiKey
    if (opts.folderId) yandex['folder_id'] = opts.folderId
    if (opts.searchIndexId) yandex['search_index_id'] = opts.searchIndexId
    aiConfig['yandex'] = yandex
  }
  if (opts?.grokApiKey) {
    aiConfig['grok'] = { api_key: opts.grokApiKey }
  }
  if (Object.keys(aiConfig).length > 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_config', ?)").run(
      JSON.stringify(aiConfig)
    )
  }

  const insertNode = db.prepare(
    `INSERT INTO lore_nodes (id, parent_id, name, content, word_count, to_be_deleted, ai_sync_info)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  let autoId = 1
  for (const n of opts?.nodes ?? []) {
    insertNode.run(
      n.id ?? autoId++,
      n.parent_id ?? null,
      n.name,
      n.content ?? null,
      n.word_count ?? 0,
      n.to_be_deleted ?? 0,
      n.ai_sync_info ?? null
    )
  }

  db.close()
  return file
}

beforeEach(() => {
  testDbPath = ''
  vi.resetAllMocks()
  mockToFile.mockResolvedValue({}) // restore default after reset
})
afterEach(() => {
  vi.useRealTimers()
  if (testDbPath) {
    try { fs.unlinkSync(testDbPath) } catch { /* ignore */ }
  }
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('syncLore', () => {

  // ─── 1. Basic validation ───────────────────────────────────────────────────

  it('throws 400 when no project open', async () => {
    testDbPath = ''
    await expect(syncLore()).rejects.toThrow(/no project open/)
    try { await syncLore() } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when no AI engine is configured', async () => {
    testDbPath = setupDb()
    await expect(syncLore()).rejects.toThrow(/no AI engine configured/)
    try { await syncLore() } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when current engine is unknown / not supported', async () => {
    testDbPath = setupDb({ currentEngine: 'unknown-engine' })
    await expect(syncLore()).rejects.toThrow(/not supported for engine 'unknown-engine'/)
    try { await syncLore() } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when api_key is missing', async () => {
    testDbPath = setupDb({ folderId: 'b1g123' })
    await expect(syncLore()).rejects.toThrow(/api_key/)
    try { await syncLore() } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when folder_id is missing', async () => {
    testDbPath = setupDb({ apiKey: 'AQVN-test' })
    await expect(syncLore()).rejects.toThrow(/folder_id/)
    try { await syncLore() } catch (e: any) { expect(e.status).toBe(400) }
  })

  // ─── 3. All nodes already synced and up-to-date ───────────────────────────

  it('returns unchanged count when all nodes are already synced', async () => {
    const syncedAt = '2025-01-01T12:00:00.000Z'
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          name: 'Chapter 1',
          content: 'Some content here',
          word_count: 3,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: syncedAt, file_id: 'f1', content_updated_at: syncedAt } }),
        },
        {
          name: 'Chapter 2',
          content: 'More content here',
          word_count: 3,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: syncedAt, file_id: 'f2', content_updated_at: '2024-12-31T00:00:00.000Z' } }),
        },
      ],
    })

    // Two unchanged nodes with file_ids → vector store will be created
    mockVsCreate.mockResolvedValueOnce({ id: 'vs-new', status: 'completed' })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.uploaded).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.unchanged).toBe(2)
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  // ─── 4. Uploads new non-empty node ────────────────────────────────────────

  it('uploads a new non-empty node and stores file_id in ai_sync_info', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 42,
          name: 'Dragon Lore',
          content: 'Dragons are ancient creatures',
          word_count: 4,
          to_be_deleted: 0,
          ai_sync_info: null,
        },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: 'remote-file-1' })
    mockVsCreate.mockResolvedValueOnce({ id: 'idx-1', status: 'completed' })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.uploaded).toBe(1)
    expect(result.deleted).toBe(0)
    expect(result.search_index_id).toBe('idx-1')

    // Verify DB was updated
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = 42').get() as { ai_sync_info: string }
    db.close()
    const syncInfo = JSON.parse(row.ai_sync_info) as { yandex: { file_id: string } }
    expect(syncInfo.yandex.file_id).toBe('remote-file-1')

    // Verify toFile was called with .md filename and correct content
    expect(mockToFile).toHaveBeenCalledOnce()
    const [toFileBuffer, toFileName, toFileOpts] = mockToFile.mock.calls[0] as unknown as [Buffer, string, { type: string }]
    expect(toFileName).toBe('lore-42.md')
    expect(toFileOpts.type).toBe('text/plain')
    // Verify YAML frontmatter in file content
    const content = toFileBuffer.toString('utf-8')
    expect(content).toContain('---')
    expect(content).toContain('path: /Dragon Lore')
    expect(content).toContain('Dragons are ancient creatures')
    // Verify files.create was called with purpose: 'assistants'
    expect(mockFilesCreate).toHaveBeenCalledOnce()
    expect(mockFilesCreate.mock.calls[0][0].purpose).toBe('assistants')
  })

  // ─── 5. Skips unchanged node ──────────────────────────────────────────────

  it('skips node where content_updated_at <= last_synced_at', async () => {
    const syncedAt = '2025-06-01T00:00:00.000Z'
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 10,
          name: 'World History',
          content: 'Long history text',
          word_count: 3,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: syncedAt, file_id: 'f-existing', content_updated_at: '2025-05-31T00:00:00.000Z' } }),
        },
      ],
    })

    mockVsCreate.mockResolvedValueOnce({ id: 'idx-new', status: 'completed' })

    const result = await syncLore()
    expect(result.uploaded).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  // ─── 6. Re-uploads changed node ───────────────────────────────────────────

  it('re-uploads node when content_updated_at > last_synced_at', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 20,
          name: 'Magic System',
          content: 'Updated magic rules',
          word_count: 3,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({
            yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'old-file', content_updated_at: '2025-06-01T00:00:00.000Z' },
          }),
        },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: 'new-file-id' })
    mockVsCreate.mockResolvedValueOnce({ id: 'idx-1', status: 'completed' })

    const result = await syncLore()
    expect(result.uploaded).toBe(1)

    // Verify new file_id stored
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = 20').get() as { ai_sync_info: string }
    db.close()
    const syncInfo = JSON.parse(row.ai_sync_info) as { yandex: { file_id: string } }
    expect(syncInfo.yandex.file_id).toBe('new-file-id')
  })

  // ─── 7. Deletes remote file for to_be_deleted=1 node ─────────────────────

  it('deletes remote file for to_be_deleted=1 node and physically removes row from DB', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 30,
          name: 'Deleted Chapter',
          content: 'Old content',
          word_count: 2,
          to_be_deleted: 1,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'del-file', content_updated_at: '2025-01-01T00:00:00.000Z' } }),
        },
      ],
    })

    mockFilesDel.mockResolvedValueOnce({ deleted: true })

    const result = await syncLore()
    expect(result.deleted).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(result.search_index_id).toBeNull()

    // Verify delete was called with the right file ID
    expect(mockFilesDel).toHaveBeenCalledWith('del-file')

    // Row must be physically removed from DB after sync
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT id FROM lore_nodes WHERE id = 30').get()
    db.close()
    expect(row).toBeUndefined()
  })

  it('Yandex: physically removes to_be_deleted=1 node that was never synced (no file_id)', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 31,
          name: 'Never Synced Node',
          content: '',
          word_count: 0,
          to_be_deleted: 1,
          ai_sync_info: null,
        },
      ],
    })

    const result = await syncLore()
    // No remote file to delete
    expect(mockFilesDel).not.toHaveBeenCalled()

    // Row must be physically removed from DB
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT id FROM lore_nodes WHERE id = 31').get()
    db.close()
    expect(row).toBeUndefined()
    void result
  })

  // ─── 8. Deletes remote file for emptied node (word_count=0) ──────────────

  it('deletes remote file for emptied node and clears file_id in ai_sync_info', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 40,
          name: 'Empty Node',
          content: '',
          word_count: 0,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'empty-file', content_updated_at: '2025-01-01T00:00:00.000Z' } }),
        },
      ],
    })

    mockFilesDel.mockResolvedValueOnce({ deleted: true })

    const result = await syncLore()
    expect(result.deleted).toBe(1)

    // Verify ai_sync_info.yandex has no file_id (but record still exists)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = 40').get() as { ai_sync_info: string }
    db.close()
    const syncInfo = JSON.parse(row.ai_sync_info) as { yandex: { last_synced_at: string; file_id?: string } }
    expect(syncInfo.yandex).toBeDefined()
    expect(syncInfo.yandex.last_synced_at).toBeDefined()
    expect(syncInfo.yandex.file_id).toBeUndefined()
  })

  // ─── 9. Deletes old VectorStore, creates new, polls until done ────────────

  it('deletes old VectorStore, creates new one, polls until done, stores search_index_id', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      searchIndexId: 'old-idx',
      nodes: [
        {
          id: 50,
          name: 'World Building',
          content: 'The world is vast',
          word_count: 4,
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2025-06-01T00:00:00.000Z', file_id: 'f-existing', content_updated_at: '2025-05-01T00:00:00.000Z' } }),
        },
      ],
    })

    mockVsDel.mockResolvedValueOnce({ deleted: true })
    mockVsCreate.mockResolvedValueOnce({ id: 'new-idx-456', status: 'in_progress' })
    mockVsRetrieve.mockResolvedValueOnce({ id: 'new-idx-456', status: 'completed' })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.search_index_id).toBe('new-idx-456')

    // Verify delete was called on old index
    expect(mockVsDel).toHaveBeenCalledWith('old-idx')
    // Verify polling was triggered
    expect(mockVsRetrieve).toHaveBeenCalledWith('new-idx-456')

    // Verify search_index_id stored in settings
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string }
    db.close()
    const config = JSON.parse(configRow.value) as { yandex: { search_index_id: string } }
    expect(config.yandex.search_index_id).toBe('new-idx-456')
  })

  // ─── 10. Empty allFileIds: delete old index, don't create new one ────────

  it('when all files deleted, removes old VectorStore and clears search_index_id', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      searchIndexId: 'old-idx',
      nodes: [
        {
          id: 60,
          name: 'Removed Chapter',
          content: 'Content',
          word_count: 1,
          to_be_deleted: 1,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'f-to-delete', content_updated_at: '2025-01-01T00:00:00.000Z' } }),
        },
      ],
    })

    mockFilesDel.mockResolvedValueOnce({ deleted: true })
    mockVsDel.mockResolvedValueOnce({ deleted: true })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.search_index_id).toBeNull()

    // VectorStore create should NOT have been called
    expect(mockVsCreate).not.toHaveBeenCalled()

    // Verify search_index_id cleared in settings
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string }
    db.close()
    const config = JSON.parse(configRow.value) as { yandex: { search_index_id?: string } }
    expect(config.yandex.search_index_id).toBeUndefined()
  })

  // ─── 11. Files uploaded first, then vector store created (Yandex) ─────────

  it('uploads all files first, then creates the vector store with those file IDs (Yandex)', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        { id: 1, name: 'Characters', content: 'Hero is brave', word_count: 3, to_be_deleted: 0, ai_sync_info: null },
        { id: 2, name: 'Locations', content: 'Dark forest', word_count: 2, to_be_deleted: 0, ai_sync_info: null },
      ],
    })

    const callOrder: string[] = []
    const uploadedFileIds: string[] = []

    mockFilesCreate
      .mockImplementationOnce(async () => { callOrder.push('files.create:1'); uploadedFileIds.push('fid-1'); return { id: 'fid-1' } })
      .mockImplementationOnce(async () => { callOrder.push('files.create:2'); uploadedFileIds.push('fid-2'); return { id: 'fid-2' } })
    mockVsCreate.mockImplementationOnce(async (params: { file_ids?: string[] }) => {
      callOrder.push('vectorStores.create')
      expect(params.file_ids).toEqual(expect.arrayContaining(['fid-1', 'fid-2']))
      return { id: 'vs-result', status: 'completed' }
    })

    const result = await syncLore()
    expect(result.uploaded).toBe(2)
    expect(result.search_index_id).toBe('vs-result')

    // Both file uploads must precede the vector store creation
    expect(callOrder).toEqual(['files.create:1', 'files.create:2', 'vectorStores.create'])

    // Vector store received both file IDs
    expect(mockVsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ file_ids: expect.arrayContaining(['fid-1', 'fid-2']) })
    )
  })

  // ─── 12. Grok: returns 400 when api_key is missing ────────────────────────

  it('throws 400 for Grok when api_key is missing', async () => {
    testDbPath = setupDb({ currentEngine: 'grok' })
    await expect(syncLore()).rejects.toThrow(/api_key/)
    try { await syncLore() } catch (e: any) { expect(e.status).toBe(400) }
  })

  // ─── 13. throws when file upload fails ────────────────────────────────────

  it('throws when file upload fails', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 70,
          name: 'New Node',
          content: 'Some content',
          word_count: 2,
          to_be_deleted: 0,
          ai_sync_info: null,
        },
      ],
    })

    mockFilesCreate.mockRejectedValueOnce(Object.assign(new Error('HTTP 500 Internal Server Error'), { status: 500 }))

    await expect(syncLore()).rejects.toThrow(/Upload failed/)
  })

  // ─── 14. throws when VectorStore polling times out ────────────────────────

  it('throws when VectorStore polling exceeds timeout', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 80,
          name: 'Long Node',
          content: 'Some content',
          word_count: 2,
          to_be_deleted: 0,
          ai_sync_info: null,
        },
      ],
    })

    const origIntervalMs = POLL_CONFIG.intervalMs
    const origTimeoutMs = POLL_CONFIG.timeoutMs
    POLL_CONFIG.intervalMs = 5
    POLL_CONFIG.timeoutMs = 20

    mockFilesCreate.mockResolvedValueOnce({ id: 'file-1' })
    mockVsCreate.mockResolvedValueOnce({ id: 'vs-timeout', status: 'in_progress' })
    // Always return in_progress → triggers timeout
    mockVsRetrieve.mockResolvedValue({ id: 'vs-timeout', status: 'in_progress' })

    try {
      await expect(syncLore()).rejects.toThrow(/timed out/)
    } finally {
      POLL_CONFIG.intervalMs = origIntervalMs
      POLL_CONFIG.timeoutMs = origTimeoutMs
    }
  })

  // ─── Grok sync (collapsed tree) ──────────────────────────────────────────

  it('Grok: physically removes to_be_deleted=1 nodes after sync', async () => {
    testDbPath = setupDb({
      grokApiKey: 'xai-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', content: null, word_count: 0 },
        {
          id: 2, parent_id: 1, name: 'Deleted Category', content: 'some text', word_count: 2,
          to_be_deleted: 1,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'grok-del-file', last_synced_at: '2025-01-01T00:00:00.000Z', content_updated_at: '2025-01-01T00:00:00.000Z' } }),
        },
        {
          id: 3, parent_id: 1, name: 'Never Synced Deleted', content: '', word_count: 0,
          to_be_deleted: 1,
          ai_sync_info: null,
        },
      ],
    })

    await syncLore()

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const rows = db.prepare('SELECT id FROM lore_nodes WHERE to_be_deleted = 1').all() as { id: number }[]
    db.close()
    expect(rows).toHaveLength(0)
  })

  it('Grok: uploads collapsed group for new nodes', async () => {
    // Tree: root(id=1) → category(id=2) → item(id=3)
    testDbPath = setupDb({
      grokApiKey: 'xai-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', content: null, word_count: 0 },
        { id: 2, parent_id: 1,    name: 'Characters', content: 'General info', word_count: 2 },
        { id: 3, parent_id: 2,    name: 'Hero',       content: 'A brave hero',  word_count: 3 },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: 'grok-file-1' })

    const result = await syncLore()
    expect(result.ok).toBe(true)
    expect(result.uploaded).toBe(1)
    expect(result.deleted).toBe(0)
    expect(result.unchanged).toBe(0)
    expect(result.search_index_id).toBeNull()

    // Level-2 node gets file_id; level-3 node gets merged_into_parent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const rows = db.prepare('SELECT id, ai_sync_info FROM lore_nodes WHERE id IN (2,3)').all() as { id: number; ai_sync_info: string }[]
    db.close()

    const byId = Object.fromEntries(rows.map(r => [r.id, JSON.parse(r.ai_sync_info)]))
    expect(byId[2].grok.file_id).toBe('grok-file-1')
    expect(byId[2].grok.merged_into_parent).toBeUndefined()
    expect(byId[3].grok.merged_into_parent).toBe(true)
    expect(byId[3].grok.file_id).toBeUndefined()
  })

  it('Grok: does not re-upload unchanged group', async () => {
    const syncedAt = '2025-01-01T12:00:00.000Z'
    testDbPath = setupDb({
      grokApiKey: 'xai-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', content: null, word_count: 0 },
        {
          id: 2, parent_id: 1, name: 'Characters', content: 'Info', word_count: 1,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'grok-f1', last_synced_at: syncedAt, content_updated_at: syncedAt } }),
        },
        {
          id: 3, parent_id: 2, name: 'Hero', content: 'Hero text', word_count: 2,
          ai_sync_info: JSON.stringify({ grok: { merged_into_parent: true, last_synced_at: syncedAt, content_updated_at: syncedAt } }),
        },
      ],
    })

    const result = await syncLore()
    expect(result.uploaded).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  it('Grok: re-uploads group when node content changed', async () => {
    const syncedAt = '2025-01-01T12:00:00.000Z'
    const updatedAt = '2025-06-01T00:00:00.000Z'
    testDbPath = setupDb({
      grokApiKey: 'xai-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', content: null, word_count: 0 },
        {
          id: 2, parent_id: 1, name: 'Characters', content: 'Info', word_count: 1,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'old-file', last_synced_at: syncedAt, content_updated_at: syncedAt } }),
        },
        {
          id: 3, parent_id: 2, name: 'Hero', content: 'Updated hero text', word_count: 3,
          ai_sync_info: JSON.stringify({ grok: { merged_into_parent: true, last_synced_at: syncedAt, content_updated_at: updatedAt } }),
        },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: 'new-grok-file' })

    const result = await syncLore()
    expect(result.uploaded).toBe(1)

    // Grok does not support file deletion — old file is left as-is
    expect(mockFilesDel).not.toHaveBeenCalled()

    // Verify new file_id stored on level-2 node
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = 2').get() as { ai_sync_info: string }
    db.close()
    const syncInfo = JSON.parse(row.ai_sync_info) as { grok: { file_id: string } }
    expect(syncInfo.grok.file_id).toBe('new-grok-file')
  })

  it('Grok: re-uploads group when a new child node is added (no grok sync entry)', async () => {
    const syncedAt = '2025-01-01T12:00:00.000Z'
    testDbPath = setupDb({
      grokApiKey: 'xai-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', content: null, word_count: 0 },
        {
          id: 2, parent_id: 1, name: 'Characters', content: 'Info', word_count: 1,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'existing-file', last_synced_at: syncedAt, content_updated_at: syncedAt } }),
        },
        // New child added after the last sync — no grok entry
        { id: 3, parent_id: 2, name: 'Villain', content: 'Newly added villain', word_count: 3, ai_sync_info: null },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: 'updated-grok-file' })

    const result = await syncLore()
    expect(result.uploaded).toBe(1)
    expect(mockFilesCreate).toHaveBeenCalledOnce()
    expect(mockFilesDel).not.toHaveBeenCalled()
  })

  it('Grok: marks group as deleted locally but does NOT call files.delete (no fileDeletion capability)', async () => {
    const syncedAt = '2025-01-01T12:00:00.000Z'
    testDbPath = setupDb({
      grokApiKey: 'xai-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', content: null, word_count: 0 },
        {
          id: 2, parent_id: 1, name: 'EmptyCategory', content: '', word_count: 0,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'old-empty-file', last_synced_at: syncedAt } }),
        },
      ],
    })

    const result = await syncLore()
    expect(result.deleted).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(mockFilesDel).not.toHaveBeenCalled()
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  it('Grok: throws 400 when too many top-level categories', async () => {
    // 11 level-2 nodes (> maxFilesPerRequest=10)
    const nodes: Array<{ id: number; parent_id: number | null; name: string; content: string | null; word_count: number }> = [
      { id: 1, parent_id: null, name: 'Root', content: null, word_count: 0 },
    ]
    for (let i = 2; i <= 12; i++) {
      nodes.push({ id: i, parent_id: 1, name: `Cat${i}`, content: `Content ${i}`, word_count: 2 })
    }
    testDbPath = setupDb({ grokApiKey: 'xai-key', nodes })

    await expect(syncLore()).rejects.toThrow(/Too many top-level lore categories/)
    try { await syncLore() } catch (e: any) { expect(e.status).toBe(400) }
    expect(mockFilesCreate).not.toHaveBeenCalled()
  })

  it('Grok: uploads correct collapsed content with markdown headings', async () => {
    testDbPath = setupDb({
      grokApiKey: 'xai-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', content: null, word_count: 0 },
        { id: 2, parent_id: 1,    name: 'World',    content: 'World overview', word_count: 2 },
        { id: 3, parent_id: 2,    name: 'Continent', content: 'Continent details', word_count: 2 },
        { id: 4, parent_id: 3,    name: 'City',      content: 'City info',       word_count: 2 },
      ],
    })

    mockFilesCreate.mockResolvedValueOnce({ id: 'grok-deep' })

    await syncLore()

    expect(mockToFile).toHaveBeenCalledOnce()
    const [buf, filename] = mockToFile.mock.calls[0] as unknown as [Buffer, string, unknown]
    expect(filename).toBe('lore-group-2.md')
    const content = buf.toString('utf-8')
    expect(content).toContain('# World')
    expect(content).toContain('World overview')
    expect(content).toContain('## World / Continent')
    expect(content).toContain('Continent details')
    expect(content).toContain('### World / Continent / City')
    expect(content).toContain('City info')
  })

  // ─── 405 fallback: retrieve check (Yandex, which supports fileDeletion) ────

  it('Yandex: treats 405 on delete as success when retrieve returns 404', async () => {
    testDbPath = setupDb({
      apiKey: 'yandex-key',
      folderId: 'folder-1',
      nodes: [
        { id: 1, parent_id: null, name: 'EmptyNode', content: null, word_count: 0,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2024-01-01T00:00:00.000Z', file_id: 'old-405-file' } }) },
      ],
    })

    // delete returns 405
    mockFilesDel.mockRejectedValueOnce(Object.assign(new Error('HTTP 405'), { status: 405 }))
    // retrieve returns 404 → file is already gone
    mockFilesRetrieve.mockRejectedValueOnce(Object.assign(new Error('HTTP 404'), { status: 404 }))
    mockVsCreate.mockResolvedValueOnce({ id: 'vs-1', status: 'completed' })

    await syncLore()
    expect(mockFilesRetrieve).toHaveBeenCalledWith('old-405-file')
  })

  it('Yandex: throws when 405 on delete and retrieve confirms file still exists', async () => {
    testDbPath = setupDb({
      apiKey: 'yandex-key',
      folderId: 'folder-1',
      nodes: [
        { id: 1, parent_id: null, name: 'EmptyNode', content: null, word_count: 0,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2024-01-01T00:00:00.000Z', file_id: 'still-there' } }) },
      ],
    })

    // delete returns 405
    mockFilesDel.mockRejectedValueOnce(Object.assign(new Error('HTTP 405'), { status: 405 }))
    // retrieve succeeds → file still present
    mockFilesRetrieve.mockResolvedValueOnce({ id: 'still-there' })

    await expect(syncLore()).rejects.toThrow(/405/)
  })
})
