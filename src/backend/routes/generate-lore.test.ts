/**
 * Integration tests for POST /api/ai/generate-lore
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
}))

// ─── OpenAI mock ──────────────────────────────────────────────────────────────

const { mockChatCreate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockChatCreate } }
  },
}))

// ─── App setup ────────────────────────────────────────────────────────────────

const { default: router } = await import('./generate-lore.js')

const app = express()
app.use(express.json())
app.use('/ai', router)

// ─── DB helper ────────────────────────────────────────────────────────────────

function setupDb(opts?: {
  currentEngine?: string
  yandexApiKey?: string
  folderId?: string
  searchIndexId?: string
  grokApiKey?: string
  textLanguage?: string
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
    `gen_lore_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file)
  db.exec(`
    CREATE TABLE lore_nodes (
      id            INTEGER PRIMARY KEY,
      parent_id     INTEGER NULL,
      name          TEXT NOT NULL,
      content       TEXT,
      word_count    INTEGER NOT NULL DEFAULT 0,
      char_count    INTEGER NOT NULL DEFAULT 0,
      byte_count    INTEGER NOT NULL DEFAULT 0,
      to_be_deleted INTEGER NOT NULL DEFAULT 0,
      ai_sync_info  TEXT NULL
    );
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  const engine = opts?.currentEngine
    ?? (opts?.grokApiKey ? 'grok' : opts?.yandexApiKey ? 'yandex' : undefined)
  if (engine) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('current_backend', ?)").run(engine)
  }

  const aiConfig: Record<string, unknown> = {}
  if (opts?.yandexApiKey || opts?.folderId) {
    const yandex: Record<string, string> = {}
    if (opts.yandexApiKey) yandex['api_key'] = opts.yandexApiKey
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

  if (opts?.textLanguage) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('text_language', ?)").run(opts.textLanguage)
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockCompletionResponse(content = 'Generated lore text') {
  mockChatCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  testDbPath = ''
  vi.clearAllMocks()
})
afterEach(() => {
  if (testDbPath) {
    try { fs.unlinkSync(testDbPath) } catch { /* ignore */ }
  }
})

describe('POST /ai/generate-lore', () => {

  // ─── 1. Basic validation ───────────────────────────────────────────────────

  it('returns 400 when no project open', async () => {
    testDbPath = ''
    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'test' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no project open')
  })

  it('returns 400 when prompt is missing', async () => {
    testDbPath = setupDb({ grokApiKey: 'key' })
    const res = await request(app).post('/ai/generate-lore').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('prompt is required')
  })

  it('returns 400 when no AI engine is configured', async () => {
    testDbPath = setupDb() // no engine
    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no AI engine configured')
  })

  it('returns 400 for an unknown engine id', async () => {
    testDbPath = setupDb({ currentEngine: 'unknown-engine' })
    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("not supported for engine 'unknown-engine'")
  })

  // ─── 2. Grok — basic generation ───────────────────────────────────────────

  it('returns generated content for Grok engine', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockCompletionResponse('A brave hero named Arin.')

    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'Describe a hero' })
    expect(res.status).toBe(200)
    expect(res.body.content).toBe('A brave hero named Arin.')
  })

  it('returns 400 when Grok api_key is missing', async () => {
    testDbPath = setupDb({ currentEngine: 'grok' }) // no grokApiKey in config
    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'test' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Grok api_key is required')
  })

  // ─── 3. Grok file attachment format ───────────────────────────────────────
  // Bug fix: xAI uses { type: 'file', file_id } not { type: 'file', file: { file_id } }

  it('attaches files using flat { type: file, file_id } format (not nested file.file_id)', async () => {
    testDbPath = setupDb({
      grokApiKey: 'grok-key',
      nodes: [
        {
          id: 1, parent_id: null, name: 'Root',
          word_count: 0, ai_sync_info: null,
        },
        {
          id: 2, parent_id: 1, name: 'Characters',
          word_count: 0,
          // Group-leader node: word_count=0 but carries a file_id
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-abc123', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockCompletionResponse('Hero content')

    await request(app).post('/ai/generate-lore').send({
      prompt: 'Describe a hero',
      includeExistingLore: true,
    })

    expect(mockChatCreate).toHaveBeenCalledOnce()
    const callArgs = mockChatCreate.mock.calls[0][0]
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
    expect(Array.isArray(userMessage.content)).toBe(true)

    const fileAttachment = (userMessage.content as Array<Record<string, unknown>>)
      .find(c => c.type === 'file')
    expect(fileAttachment).toBeDefined()
    // Must use flat format: { type: 'file', file_id: '...' }
    expect(fileAttachment!.file_id).toBe('file-abc123')
    // Must NOT use nested format: { type: 'file', file: { file_id: '...' } }
    expect(fileAttachment!.file).toBeUndefined()
  })

  // ─── 4. Grok group-leader nodes (word_count=0) included in file list ───────
  // Bug fix: SQL previously filtered AND word_count > 0, excluding Grok group-leader nodes

  it('includes file IDs from group-leader nodes with word_count=0', async () => {
    testDbPath = setupDb({
      grokApiKey: 'grok-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', word_count: 0, ai_sync_info: null },
        {
          id: 2, parent_id: 1, name: 'Characters', word_count: 0,
          // Group-leader: no own text but file uploaded for the whole subtree
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-leader', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
        {
          id: 3, parent_id: 2, name: 'Hero', word_count: 5,
          // Merged-into-parent: no file_id (merged into group leader)
          ai_sync_info: JSON.stringify({ grok: { merged_into_parent: true, last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockCompletionResponse('Hero lore')

    await request(app).post('/ai/generate-lore').send({
      prompt: 'Tell me about the hero',
      includeExistingLore: true,
    })

    expect(mockChatCreate).toHaveBeenCalledOnce()
    const callArgs = mockChatCreate.mock.calls[0][0]
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
    const fileAttachments = (userMessage.content as Array<Record<string, unknown>>)
      .filter(c => c.type === 'file')

    // The group-leader node (word_count=0) must be included
    expect(fileAttachments.some(f => f.file_id === 'file-leader')).toBe(true)
    // The merged-into-parent node has no file_id — should not appear
    expect(fileAttachments).toHaveLength(1)
  })

  it('does not include file IDs from to_be_deleted nodes', async () => {
    testDbPath = setupDb({
      grokApiKey: 'grok-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', word_count: 0, ai_sync_info: null },
        {
          id: 2, parent_id: 1, name: 'Deleted', word_count: 5, to_be_deleted: 1,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-deleted', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
        {
          id: 3, parent_id: 1, name: 'Active', word_count: 5,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-active', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockCompletionResponse('Some lore')

    await request(app).post('/ai/generate-lore').send({
      prompt: 'test',
      includeExistingLore: true,
    })

    const callArgs = mockChatCreate.mock.calls[0][0]
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
    const fileAttachments = (userMessage.content as Array<Record<string, unknown>>)
      .filter(c => c.type === 'file')

    expect(fileAttachments.some(f => f.file_id === 'file-active')).toBe(true)
    expect(fileAttachments.some(f => f.file_id === 'file-deleted')).toBe(false)
  })

  it('sends only text content when includeExistingLore is false', async () => {
    testDbPath = setupDb({
      grokApiKey: 'grok-key',
      nodes: [
        {
          id: 1, parent_id: null, name: 'Node', word_count: 5,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-xyz', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockCompletionResponse('Some lore')

    await request(app).post('/ai/generate-lore').send({
      prompt: 'test',
      includeExistingLore: false,
    })

    const callArgs = mockChatCreate.mock.calls[0][0]
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
    // When includeExistingLore=false, content should be a plain string (not array)
    // OR an array with only text (no file attachments)
    const fileAttachments = Array.isArray(userMessage.content)
      ? (userMessage.content as Array<Record<string, unknown>>).filter(c => c.type === 'file')
      : []
    expect(fileAttachments).toHaveLength(0)
  })

  // ─── 5. Yandex — basic generation ─────────────────────────────────────────

  it('returns generated content for Yandex engine', async () => {
    testDbPath = setupDb({ yandexApiKey: 'yandex-key', folderId: 'folder-1' })
    mockCompletionResponse('Yandex lore result')

    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'Create a world' })
    expect(res.status).toBe(200)
    expect(res.body.content).toBe('Yandex lore result')
  })

  it('returns 400 when Yandex api_key or folder_id is missing', async () => {
    testDbPath = setupDb({ currentEngine: 'yandex' }) // no credentials
    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'test' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Yandex api_key and folder_id are required')
  })

  // ─── 6. text_language setting ─────────────────────────────────────────────

  it('uses text_language from settings in the system prompt', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key', textLanguage: 'en-US' })
    mockCompletionResponse('English lore')

    await request(app).post('/ai/generate-lore').send({ prompt: 'Describe a wizard' })

    const callArgs = mockChatCreate.mock.calls[0][0]
    const systemMessage = callArgs.messages.find((m: { role: string }) => m.role === 'system')
    expect(systemMessage.content).toContain('en-US')
  })

  it('defaults to ru-RU when text_language is not set', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockCompletionResponse('Russian lore')

    await request(app).post('/ai/generate-lore').send({ prompt: 'Describe a hero' })

    const callArgs = mockChatCreate.mock.calls[0][0]
    const systemMessage = callArgs.messages.find((m: { role: string }) => m.role === 'system')
    expect(systemMessage.content).toContain('ru-RU')
  })
})
