/**
 * Integration tests for POST /api/ai/yandex/sync-lore
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import express from 'express'
import request from 'supertest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let testDbPath = ''

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => testDbPath,
  getDataDir: () => os.tmpdir(),
}))

const { default: router, POLL_CONFIG } = await import('./yandex-sync.js')

const app = express()
app.use(express.json())
app.use('/ai', router)

function setupDb(opts?: {
  apiKey?: string
  folderId?: string
  searchIndexId?: string
  nodes?: Array<{
    id?: number
    name: string
    content?: string | null
    word_count?: number
    to_be_deleted?: number
    ai_sync_info?: string | null
  }>
}): string {
  const file = path.join(
    os.tmpdir(),
    `yandex_sync_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file)
  db.exec(`
    CREATE TABLE lore_nodes (
      id                INTEGER PRIMARY KEY,
      parent_id         INTEGER NULL,
      name              TEXT NOT NULL,
      content           TEXT,
      position          INTEGER DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'ACTIVE',
      to_be_deleted     INTEGER NOT NULL DEFAULT 0,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      word_count        INTEGER NOT NULL DEFAULT 0,
      char_count        INTEGER NOT NULL DEFAULT 0,
      byte_count        INTEGER NOT NULL DEFAULT 0,
      ai_sync_info      TEXT NULL
    );
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Insert credentials if provided
  if (opts?.apiKey || opts?.folderId) {
    const yandex: Record<string, string> = {}
    if (opts.apiKey) yandex['api_key'] = opts.apiKey
    if (opts.folderId) yandex['folder_id'] = opts.folderId
    if (opts.searchIndexId) yandex['search_index_id'] = opts.searchIndexId
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_config', ?)").run(
      JSON.stringify({ yandex })
    )
  }

  // Insert nodes
  const insertNode = db.prepare(
    `INSERT INTO lore_nodes (id, name, content, word_count, to_be_deleted, ai_sync_info)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  let autoId = 1
  for (const n of opts?.nodes ?? []) {
    insertNode.run(
      n.id ?? autoId++,
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

beforeEach(() => { testDbPath = '' })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (testDbPath) {
    try { fs.unlinkSync(testDbPath) } catch { /* ignore */ }
  }
})

// ─── 1. 400 when no project open ──────────────────────────────────────────────

describe('POST /ai/yandex/sync-lore', () => {
  it('returns 400 when no project open', async () => {
    testDbPath = ''
    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no project open')
  })

  // ─── 2. 400 when credentials missing ────────────────────────────────────────

  it('returns 400 when api_key is missing', async () => {
    testDbPath = setupDb({ folderId: 'b1g123' }) // no api_key
    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('api_key')
  })

  it('returns 400 when folder_id is missing', async () => {
    testDbPath = setupDb({ apiKey: 'AQVN-test' }) // no folder_id
    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('folder_id')
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
          // content_updated_at == last_synced_at → unchanged
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: syncedAt, file_id: 'f1', content_updated_at: syncedAt } }),
        },
        {
          name: 'Chapter 2',
          content: 'More content here',
          word_count: 3,
          to_be_deleted: 0,
          // content_updated_at < last_synced_at → unchanged
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: syncedAt, file_id: 'f2', content_updated_at: '2024-12-31T00:00:00.000Z' } }),
        },
      ],
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ // POST create search index (2 file_ids exist)
        ok: true,
        json: async () => ({ id: 'op-1', done: true, response: { id: 'new-idx' } }),
      })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.uploaded).toBe(0)
    expect(res.body.deleted).toBe(0)
    expect(res.body.unchanged).toBe(2)
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
          ai_sync_info: null, // never synced → always uploaded
        },
      ],
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ // POST upload file
        ok: true,
        json: async () => ({ id: 'remote-file-1' }),
      })
      .mockResolvedValueOnce({ // POST create search index
        ok: true,
        json: async () => ({ id: 'op-1', done: true, response: { id: 'idx-1' } }),
      })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.uploaded).toBe(1)
    expect(res.body.deleted).toBe(0)
    expect(res.body.search_index_id).toBe('idx-1')

    // Verify DB was updated
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = 42').get() as { ai_sync_info: string }
    db.close()
    const syncInfo = JSON.parse(row.ai_sync_info) as { yandex: { file_id: string } }
    expect(syncInfo.yandex.file_id).toBe('remote-file-1')
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
          // content_updated_at BEFORE last_synced_at → unchanged
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: syncedAt, file_id: 'f-existing', content_updated_at: '2025-05-31T00:00:00.000Z' } }),
        },
      ],
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ // POST create search index (uses existing file_id)
        ok: true,
        json: async () => ({ id: 'op-1', done: true, response: { id: 'idx-new' } }),
      })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(200)
    expect(res.body.uploaded).toBe(0)
    expect(res.body.unchanged).toBe(1)

    // Upload endpoint should NOT have been called
    const uploadCalled = mockFetch.mock.calls.some(
      ([url]: [string]) => url.includes('/files/v1/files') && !url.includes('DELETE')
    )
    expect(uploadCalled).toBe(false)
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
          // content_updated_at AFTER last_synced_at → needs upload
          ai_sync_info: JSON.stringify({
            yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'old-file', content_updated_at: '2025-06-01T00:00:00.000Z' },
          }),
        },
      ],
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ // POST upload file → new file ID
        ok: true,
        json: async () => ({ id: 'new-file-id' }),
      })
      .mockResolvedValueOnce({ // POST create search index
        ok: true,
        json: async () => ({ id: 'op-1', done: true, response: { id: 'idx-1' } }),
      })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(200)
    expect(res.body.uploaded).toBe(1)

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

  it('deletes remote file for to_be_deleted=1 node and clears ai_sync_info.yandex', async () => {
    testDbPath = setupDb({
      apiKey: 'AQVN-key',
      folderId: 'b1g123',
      nodes: [
        {
          id: 30,
          name: 'Deleted Chapter',
          content: 'Old content',
          word_count: 2,
          to_be_deleted: 1, // marked for deletion
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'del-file', content_updated_at: '2025-01-01T00:00:00.000Z' } }),
        },
      ],
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // DELETE file → success
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(1)
    expect(res.body.uploaded).toBe(0)
    expect(res.body.search_index_id).toBeNull() // no files left

    // Verify ai_sync_info.yandex was cleared in DB
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = 30').get() as { ai_sync_info: string }
    db.close()
    const syncInfo = JSON.parse(row.ai_sync_info) as Record<string, unknown>
    expect(syncInfo['yandex']).toBeUndefined()

    // Verify delete was called with the right file ID
    const deleteCall = mockFetch.mock.calls.find(
      ([url, opts]: [string, RequestInit]) => url.includes('del-file') && opts?.method === 'DELETE'
    )
    expect(deleteCall).toBeDefined()
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
          word_count: 0, // empty
          to_be_deleted: 0,
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'empty-file', content_updated_at: '2025-01-01T00:00:00.000Z' } }),
        },
      ],
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // DELETE file
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(1)

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

  // ─── 9. Calls SearchIndex delete (old) then create + poll ────────────────

  it('deletes old SearchIndex, creates new one, polls until done, stores search_index_id', async () => {
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
          // Already synced with a file_id, content_updated_at < last_synced_at → unchanged
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2025-06-01T00:00:00.000Z', file_id: 'f-existing', content_updated_at: '2025-05-01T00:00:00.000Z' } }),
        },
      ],
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // DELETE old index
      .mockResolvedValueOnce({ // POST create search index → returns pending operation
        ok: true,
        json: async () => ({ id: 'op-new', done: false }),
      })
      .mockResolvedValueOnce({ // GET operation (poll 1) → done immediately (no 5s sleep)
        ok: true,
        json: async () => ({ done: true, response: { id: 'new-idx-456' } }),
      })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.search_index_id).toBe('new-idx-456')

    // Verify search_index_id stored in settings
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string }
    db.close()
    const config = JSON.parse(configRow.value) as { yandex: { search_index_id: string } }
    expect(config.yandex.search_index_id).toBe('new-idx-456')

    // Verify delete was called on the old index
    const deleteCall = mockFetch.mock.calls.find(
      ([url, opts]: [string, RequestInit]) => url.includes('old-idx') && opts?.method === 'DELETE'
    )
    expect(deleteCall).toBeDefined()
  })

  // ─── 10. Empty allFileIds: delete old index, don't create new one ────────

  it('when all files deleted, removes old index and clears search_index_id', async () => {
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
          to_be_deleted: 1, // will be deleted
          ai_sync_info: JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'f-to-delete', content_updated_at: '2025-01-01T00:00:00.000Z' } }),
        },
      ],
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // DELETE remote file
      .mockResolvedValueOnce({ ok: true, status: 200 }) // DELETE old search index
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.search_index_id).toBeNull()

    // POST create index should NOT have been called
    const createCall = mockFetch.mock.calls.find(
      ([url, opts]: [string, RequestInit]) =>
        url.includes('/searchindex/v1/searchindex') && opts?.method === 'POST'
    )
    expect(createCall).toBeUndefined()

    // Verify search_index_id cleared in settings
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string }
    db.close()
    const config = JSON.parse(configRow.value) as { yandex: { search_index_id?: string } }
    expect(config.yandex.search_index_id).toBeUndefined()
  })

  // ─── 11. 500 if file upload fails ─────────────────────────────────────────

  it('returns 500 when file upload fails', async () => {
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
          ai_sync_info: null, // never synced → will try to upload
        },
      ],
    })

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('Upload failed')
  })

  // ─── 12. 500 if SearchIndex polling times out ─────────────────────────────

  it('returns 500 when SearchIndex polling exceeds timeout', async () => {
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
          ai_sync_info: null, // never synced → will try to upload
        },
      ],
    })

    // Use a tiny real timeout so the poll loop expires quickly without fake timers
    const origIntervalMs = POLL_CONFIG.intervalMs
    const origTimeoutMs = POLL_CONFIG.timeoutMs
    POLL_CONFIG.intervalMs = 5
    POLL_CONFIG.timeoutMs = 20

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.includes('/files/v1/files')) {
        return { ok: true, json: async () => ({ id: 'file-1' }) }
      }
      if (urlStr.includes('/searchindex/v1/searchindex') && !urlStr.includes('DELETE')) {
        return { ok: true, json: async () => ({ id: 'op-timeout', done: false }) }
      }
      if (urlStr.includes('/operations/')) {
        return { ok: true, json: async () => ({ done: false }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/yandex/sync-lore')

    POLL_CONFIG.intervalMs = origIntervalMs
    POLL_CONFIG.timeoutMs = origTimeoutMs

    expect(res.status).toBe(500)
    expect(res.body.error).toContain('timed out')
  })
})
