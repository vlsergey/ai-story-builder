/**
 * Integration tests for POST /api/ai/generate-summary
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { app } from '../server.js'

let testDbPath = ''

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => testDbPath,
  getDataDir: () => '/tmp/test-data',
  restoreLastOpenedProject: () => null,
}))

// ─── AI engine adapter mock ──────────────────────────────────────────────────

const { mockGenerateResponse } = vi.hoisted(() => ({
  mockGenerateResponse: vi.fn(),
}))

vi.mock('../lib/ai-engine-adapter.js', () => ({
  getEngineAdapter: () => ({
    generateResponse: mockGenerateResponse,
  }),
}))

// ─── DB helper ───────────────────────────────────────────────────────────────

function setupDb(opts?: {
  currentEngine?: string
  yandexApiKey?: string
  folderId?: string
  grokApiKey?: string
  textLanguage?: string | null
  autoGenerateSummary?: boolean
  summarySettings?: Record<string, unknown>
  planNode?: {
    id: number
    content?: string | null
    summary?: string | null
    auto_summary?: number
  }
}): string {
  const file = path.join(
    os.tmpdir(),
    `gen_summary_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file)
  db.exec(`
    CREATE TABLE plan_nodes (
      id            INTEGER PRIMARY KEY,
      content       TEXT,
      summary       TEXT,
      auto_summary  INTEGER NOT NULL DEFAULT 0
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
    aiConfig['yandex'] = yandex
  }
  if (opts?.grokApiKey) {
    aiConfig['grok'] = { api_key: opts.grokApiKey }
  }
  // Add summary settings if provided
  if (opts?.summarySettings && engine) {
    if (!aiConfig[engine]) {
      aiConfig[engine] = {}
    }
    (aiConfig[engine] as Record<string, unknown>).summary_settings = opts.summarySettings
  }
  if (Object.keys(aiConfig).length > 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_config', ?)").run(
      JSON.stringify(aiConfig)
    )
  }

  const lang = opts?.textLanguage !== undefined ? opts.textLanguage : 'ru-RU'
  if (lang !== null) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('text_language', ?)").run(lang)
  }

  const autoGenerate = opts?.autoGenerateSummary ?? true
  db.prepare("INSERT INTO settings (key, value) VALUES ('auto_generate_summary', ?)").run(
    String(autoGenerate)
  )

  if (opts?.planNode) {
    db.prepare(
      'INSERT INTO plan_nodes (id, content, summary, auto_summary) VALUES (?, ?, ?, ?)'
    ).run(
      opts.planNode.id,
      opts.planNode.content ?? null,
      opts.planNode.summary ?? null,
      opts.planNode.auto_summary ?? 0
    )
  }

  db.close()
  return file
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  testDbPath = ''
  vi.clearAllMocks()
})

afterEach(() => {
  if (testDbPath) {
    try { fs.unlinkSync(testDbPath) } catch { /* ignore */ }
  }
})

describe('POST /api/ai/generate-summary', () => {
  it('returns 400 when no project open', async () => {
    testDbPath = ''
    const res = await request(app).post('/api/ai/generate-summary').send({ node_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no project open')
  })

  it('returns 400 when node_id is missing', async () => {
    testDbPath = setupDb({ grokApiKey: 'key' })
    const res = await request(app).post('/api/ai/generate-summary').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('node_id is required')
  })

  it('returns 400 when no AI engine configured', async () => {
    testDbPath = setupDb() // no engine
    const res = await request(app).post('/api/ai/generate-summary').send({ node_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no AI engine configured')
  })

  it('returns 400 when plan node content is empty', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      planNode: { id: 1, content: '' },
    })
    const res = await request(app).post('/api/ai/generate-summary').send({ node_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('plan node content is empty')
  })

  it('returns JSON response and updates node summary', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      planNode: { id: 1, content: 'A long story about a hero.' },
    })

    mockGenerateResponse.mockImplementationOnce(async (params, onThinking, onDelta) => {
      onThinking?.('thinking', 'thinking detail')
      onDelta?.('Summary text')
      return {
        response_id: 'resp-123',
        tokensInput: 10,
        tokensOutput: 5,
        tokensTotal: 15,
        cachedTokens: 0,
        reasoningTokens: 0,
        costUsdTicks: 100,
      }
    })

    const res = await request(app).post('/api/ai/generate-summary').send({ node_id: 1 })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)

    const body = res.body
    expect(body.summary).toBe('Summary text')
    expect(body.response_id).toBe('resp-123')
    expect(body.tokens_input).toBe(10)
    expect(body.tokens_output).toBe(5)
    expect(body.tokens_total).toBe(15)
    expect(body.cached_tokens).toBe(0)
    expect(body.reasoning_tokens).toBe(0)
    expect(body.cost_usd_ticks).toBe(100)

    // Verify that the node was updated
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    const row = db.prepare('SELECT summary, auto_summary FROM plan_nodes WHERE id = 1').get() as {
      summary: string
      auto_summary: number
    } | undefined
    db.close()
    expect(row).toBeDefined()
    expect(row?.auto_summary).toBe(1)
    expect(row?.summary).toBe('Summary text')
  })

  it('uses content from request body if provided', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      planNode: { id: 1, content: 'Old content' },
    })

    mockGenerateResponse.mockImplementationOnce(async (params, onThinking, onDelta) => {
      onThinking?.('thinking', 'thinking detail')
      onDelta?.('Summary text')
      return {
        response_id: 'resp-456',
        tokensInput: 0,
        tokensOutput: 0,
        tokensTotal: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        costUsdTicks: 0,
      }
    })

    await request(app).post('/api/ai/generate-summary').send({
      node_id: 1,
      content: 'New content for summary',
    })

    // The mock should have been called with the new content
    expect(mockGenerateResponse).toHaveBeenCalledOnce()
    const call = mockGenerateResponse.mock.calls[0]
    const params = call[0] // first argument is the request object
    expect(params.prompt).toContain('New content for summary')
  })

  it('respects auto_generate_summary setting (false)', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      autoGenerateSummary: false,
      planNode: { id: 1, content: 'Some content' },
    })

    mockGenerateResponse.mockImplementationOnce(async (params, onThinking, onDelta) => {
      onThinking?.('thinking', 'thinking detail')
      onDelta?.('Summary text')
      return {
        response_id: 'resp-789',
        tokensInput: 0,
        tokensOutput: 0,
        tokensTotal: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        costUsdTicks: 0,
      }
    })

    const res = await request(app).post('/api/ai/generate-summary').send({ node_id: 1 })
    // Should still generate (the endpoint does not block when setting is false)
    expect(res.status).toBe(200)
    expect(mockGenerateResponse).toHaveBeenCalledOnce()
  })

  it('stores plain text summary (not JSON) when adapter returns plain text', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      planNode: { id: 1, content: 'Some content' },
    })

    mockGenerateResponse.mockImplementationOnce(async (params, onThinking, onDelta) => {
      onThinking?.('thinking', 'thinking detail')
      onDelta?.('A plain text summary')
      return {
        response_id: 'resp-xyz',
        tokensInput: 0,
        tokensOutput: 0,
        tokensTotal: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        costUsdTicks: 0,
      }
    })

    const res = await request(app).post('/api/ai/generate-summary').send({ node_id: 1 })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)

    const body = res.body
    expect(body.summary).toBe('A plain text summary')
    expect(body.response_id).toBe('resp-xyz')

    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    const row = db.prepare('SELECT summary, auto_summary FROM plan_nodes WHERE id = 1').get() as {
      summary: string
      auto_summary: number
    } | undefined
    db.close()
    expect(row).toBeDefined()
    expect(row?.auto_summary).toBe(1)
    expect(row?.summary).toBe('A plain text summary')
    // Ensure it's not JSON
    expect(() => JSON.parse(row!.summary)).toThrow()
  })
})