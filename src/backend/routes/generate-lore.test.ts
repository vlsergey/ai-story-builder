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

// ─── OpenAI mock (used by Yandex) ─────────────────────────────────────────────

const { mockChatCreate, mockGrokGenerate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
  mockGrokGenerate: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockChatCreate } }
  },
}))

vi.mock('../lib/grok-client.js', () => ({
  grokGenerate: mockGrokGenerate,
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

function parseSseEvents(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  let event = ''
  for (const line of body.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) {
      events.push({ event, data: JSON.parse(line.slice(6)) as Record<string, unknown> })
      event = ''
    }
  }
  return events
}

function ssePartialJson(events: ReturnType<typeof parseSseEvents>): Record<string, unknown> {
  const partials = events.filter(e => e.event === 'partial_json')
  return (partials[partials.length - 1]?.data ?? {}) as Record<string, unknown>
}

function mockYandexResponse(content = JSON.stringify({ name: 'Lore item', content: 'Generated lore text' })) {
  mockChatCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  })
}

function mockGrokResponse(content = JSON.stringify({ name: 'Lore item', content: 'Generated lore text' })) {
  mockGrokGenerate.mockImplementationOnce(
    async (_apiKey: string, _params: Record<string, unknown>, _onThinking?: (status: string) => void, onDelta?: (text: string) => void) => {
      onDelta?.(content)
      return content
    }
  )
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
    mockGrokResponse(JSON.stringify({ name: 'Arin', content: 'A brave hero named Arin.' }))

    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'Describe a hero' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    const events = parseSseEvents(res.text)
    const last = ssePartialJson(events)
    expect(last.name).toBe('Arin')
    expect(last.content).toBe('A brave hero named Arin.')
    expect(events.some(e => e.event === 'thinking' && e.data.status === 'done')).toBe(true)
  })

  it('returns SSE error when Grok api_key is missing', async () => {
    testDbPath = setupDb({ currentEngine: 'grok' }) // no grokApiKey in config
    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'test' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    const events = parseSseEvents(res.text)
    const errorEvent = events.find(e => e.event === 'error')
    expect(errorEvent?.data.message).toContain('Grok api_key is required')
  })

  // ─── 3. Grok file attachment format ───────────────────────────────────────

  it('attaches files using { type: input_file, file_id } format in Responses API', async () => {
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
    mockGrokResponse('Hero content')

    await request(app).post('/ai/generate-lore').send({
      prompt: 'Describe a hero',
      includeExistingLore: true,
    })

    expect(mockGrokGenerate).toHaveBeenCalledOnce()
    const params = mockGrokGenerate.mock.calls[0][1] as {
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>
    }
    const userMessage = params.input.find((m) => m.role === 'user')
    expect(Array.isArray(userMessage!.content)).toBe(true)

    const fileAttachment = userMessage!.content.find(c => c.type === 'input_file')
    expect(fileAttachment).toBeDefined()
    expect(fileAttachment!.file_id).toBe('file-abc123')
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
    mockGrokResponse('Hero lore')

    await request(app).post('/ai/generate-lore').send({
      prompt: 'Tell me about the hero',
      includeExistingLore: true,
    })

    expect(mockGrokGenerate).toHaveBeenCalledOnce()
    const params = mockGrokGenerate.mock.calls[0][1] as {
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>
    }
    const userMessage = params.input.find((m) => m.role === 'user')
    const fileAttachments = userMessage!.content.filter(c => c.type === 'input_file')

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
    mockGrokResponse('Some lore')

    await request(app).post('/ai/generate-lore').send({
      prompt: 'test',
      includeExistingLore: true,
    })

    const params = mockGrokGenerate.mock.calls[0][1] as {
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>
    }
    const userMessage = params.input.find((m) => m.role === 'user')
    const fileAttachments = userMessage!.content.filter(c => c.type === 'input_file')

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
    mockGrokResponse('Some lore')

    await request(app).post('/ai/generate-lore').send({
      prompt: 'test',
      includeExistingLore: false,
    })

    const params = mockGrokGenerate.mock.calls[0][1] as {
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>
    }
    const userMessage = params.input.find((m) => m.role === 'user')
    const fileAttachments = userMessage!.content.filter(c => c.type === 'input_file')
    expect(fileAttachments).toHaveLength(0)
  })

  // ─── 5. Yandex — basic generation ─────────────────────────────────────────

  it('returns generated content for Yandex engine', async () => {
    testDbPath = setupDb({ yandexApiKey: 'yandex-key', folderId: 'folder-1' })
    mockYandexResponse(JSON.stringify({ name: 'World', content: 'Yandex lore result' }))

    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'Create a world' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    const events = parseSseEvents(res.text)
    const last = ssePartialJson(events)
    expect(last.name).toBe('World')
    expect(last.content).toBe('Yandex lore result')
    expect(events.some(e => e.event === 'thinking' && e.data.status === 'done')).toBe(true)
  })

  it('returns SSE error when Yandex api_key or folder_id is missing', async () => {
    testDbPath = setupDb({ currentEngine: 'yandex' }) // no credentials
    const res = await request(app).post('/ai/generate-lore').send({ prompt: 'test' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    const events = parseSseEvents(res.text)
    const errorEvent = events.find(e => e.event === 'error')
    expect(errorEvent?.data.message).toContain('Yandex api_key and folder_id are required')
  })

  // ─── 6. text_language setting ─────────────────────────────────────────────

  it('uses text_language from settings in the system prompt', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key', textLanguage: 'en-US' })
    mockGrokResponse()

    await request(app).post('/ai/generate-lore').send({ prompt: 'Describe a wizard' })

    const params = mockGrokGenerate.mock.calls[0][1] as { instructions: string }
    expect(params.instructions).toContain('en-US')
  })

  it('omits Language line in system prompt when text_language is not set', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse()

    await request(app).post('/ai/generate-lore').send({ prompt: 'Describe a hero' })

    const params = mockGrokGenerate.mock.calls[0][1] as { instructions: string }
    expect(params.instructions).not.toContain('Language:')
  })

  // ─── 7. Grok web search ────────────────────────────────────────────────────

  it('passes web_search tool to Grok when webSearch is enabled', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse('Lore with web info')

    await request(app).post('/ai/generate-lore').send({ prompt: 'News', webSearch: 'on' })

    const params = mockGrokGenerate.mock.calls[0][1] as { tools?: unknown[] }
    expect(params.tools).toEqual([{ type: 'web_search' }])
  })

  it('does not pass tools to Grok when webSearch is none', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse('Normal lore')

    await request(app).post('/ai/generate-lore').send({ prompt: 'Something', webSearch: 'none' })

    const params = mockGrokGenerate.mock.calls[0][1] as { tools?: unknown[] }
    expect(params.tools).toBeUndefined()
  })

  // ─── 8. Structured JSON output ─────────────────────────────────────────────

  it('emits partial_json events (not delta) for Grok', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    const jsonResponse = JSON.stringify({ name: 'Arin the Brave', content: '## Hero\nA brave warrior.' })
    mockGrokResponse(jsonResponse)

    const res = await request(app).post('/ai/generate-lore').send({
      prompt: 'Describe a hero',
    })

    expect(res.status).toBe(200)
    const events = parseSseEvents(res.text)

    // No delta events when schema is used
    expect(events.some(e => e.event === 'delta')).toBe(false)

    // partial_json events present
    expect(events.some(e => e.event === 'partial_json')).toBe(true)

    // Last partial_json has correct fields
    const last = ssePartialJson(events)
    expect(last.name).toBe('Arin the Brave')
    expect(last.content).toBe('## Hero\nA brave warrior.')

    // Grok was called with json_schema format
    const params = mockGrokGenerate.mock.calls[0][1] as { text?: { format?: { type?: string } } }
    expect(params.text?.format?.type).toBe('json_schema')
  })

  it('emits partial_json events (not delta) for Yandex', async () => {
    testDbPath = setupDb({ yandexApiKey: 'yandex-key', folderId: 'folder-1' })
    const jsonResponse = JSON.stringify({ name: 'Mystic Forest', content: '## Forest\nA place of wonder.' })
    mockYandexResponse(jsonResponse)

    const res = await request(app).post('/ai/generate-lore').send({
      prompt: 'Describe a location',
    })

    expect(res.status).toBe(200)
    const events = parseSseEvents(res.text)

    // No delta events when schema is used
    expect(events.some(e => e.event === 'delta')).toBe(false)

    // partial_json events present
    expect(events.some(e => e.event === 'partial_json')).toBe(true)

    // Last partial_json has correct fields
    const last = ssePartialJson(events)
    expect(last.name).toBe('Mystic Forest')
    expect(last.content).toBe('## Forest\nA place of wonder.')

    // Yandex was called with json_schema response_format
    const params = mockChatCreate.mock.calls[0][0] as { response_format?: { type?: string } }
    expect(params.response_format?.type).toBe('json_schema')
  })
})
