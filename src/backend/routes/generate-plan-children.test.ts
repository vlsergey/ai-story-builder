/**
 * Integration tests for POST /api/ai/generate-plan-children
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

const { mockGrokGenerate } = vi.hoisted(() => ({
  mockGrokGenerate: vi.fn(),
}))

vi.mock('../lib/grok-client.js', () => ({
  grokGenerate: mockGrokGenerate,
}))

const { default: router } = await import('./generate-plan-children.js')

const app = express()
app.use(express.json())
app.use('/ai', router)

// ─── DB helper ────────────────────────────────────────────────────────────────

function setupDb(opts?: {
  grokApiKey?: string
  textLanguage?: string | null
  loreNodes?: Array<{
    id?: number
    parent_id?: number | null
    name: string
    word_count?: number
    to_be_deleted?: number
    ai_sync_info?: string | null
  }>
}): string {
  const file = path.join(
    os.tmpdir(),
    `gen_plan_children_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
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
      to_be_deleted INTEGER NOT NULL DEFAULT 0,
      ai_sync_info  TEXT NULL
    );
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  if (opts?.grokApiKey) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('current_backend', 'grok')").run()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_config', ?)").run(
      JSON.stringify({ grok: { api_key: opts.grokApiKey } })
    )
  }

  const lang = opts?.textLanguage !== undefined ? opts.textLanguage : 'ru-RU'
  if (lang !== null) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('text_language', ?)").run(lang)
  }

  const insertNode = db.prepare(
    `INSERT INTO lore_nodes (id, parent_id, name, word_count, to_be_deleted, ai_sync_info)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  let autoId = 1
  for (const n of opts?.loreNodes ?? []) {
    insertNode.run(
      n.id ?? autoId++,
      n.parent_id ?? null,
      n.name,
      n.word_count ?? 0,
      n.to_be_deleted ?? 0,
      n.ai_sync_info ?? null
    )
  }

  db.close()
  return file
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockGrokResponse(content = JSON.stringify({ overview: 'Overview', items: [{ title: 'Chapter 1', content: 'Content' }] })) {
  mockGrokGenerate.mockImplementationOnce(
    async (_apiKey: string, _params: Record<string, unknown>, _onThinking?: (status: string) => void, onDelta?: (text: string) => void) => {
      onDelta?.(content)
      return { text: content, response_id: 'test-response-id' }
    }
  )
}

function getGrokCallUserContent(): Array<Record<string, unknown>> {
  const params = mockGrokGenerate.mock.calls[0][1] as {
    input: Array<{ role: string; content: Array<Record<string, unknown>> }>
  }
  return params.input.find(m => m.role === 'user')!.content
}

beforeEach(() => {
  testDbPath = ''
  vi.clearAllMocks()
})
afterEach(() => {
  if (testDbPath) {
    try { fs.unlinkSync(testDbPath) } catch { /* ignore */ }
  }
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /ai/generate-plan-children', () => {

  // ─── 1. Basic validation ───────────────────────────────────────────────────

  it('returns 400 when no project open', async () => {
    testDbPath = ''
    const res = await request(app).post('/ai/generate-plan-children').send({ prompt: 'test', parentTitle: 'Act 1' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no project open')
  })

  it('returns 400 when prompt is missing', async () => {
    testDbPath = setupDb({ grokApiKey: 'key' })
    const res = await request(app).post('/ai/generate-plan-children').send({ parentTitle: 'Act 1' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('prompt is required')
  })

  // ─── 2. includeExistingLore: file ID propagation ───────────────────────────

  it('attaches lore file IDs to the Grok request when includeExistingLore=true', async () => {
    testDbPath = setupDb({
      grokApiKey: 'grok-key',
      loreNodes: [
        {
          id: 1, parent_id: null, name: 'Characters', word_count: 5,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-lore-abc', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockGrokResponse()

    await request(app).post('/ai/generate-plan-children').send({
      prompt: 'Split into chapters',
      parentTitle: 'Act 1',
      settings: { includeExistingLore: true },
    })

    expect(mockGrokGenerate).toHaveBeenCalledOnce()
    const content = getGrokCallUserContent()
    const fileAttachments = content.filter(c => c['type'] === 'input_file')
    expect(fileAttachments.some(f => f['file_id'] === 'file-lore-abc')).toBe(true)
  })

  it('does not attach lore file IDs when includeExistingLore=false', async () => {
    testDbPath = setupDb({
      grokApiKey: 'grok-key',
      loreNodes: [
        {
          id: 1, parent_id: null, name: 'Characters', word_count: 5,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-lore-abc', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockGrokResponse()

    await request(app).post('/ai/generate-plan-children').send({
      prompt: 'Split into chapters',
      parentTitle: 'Act 1',
      settings: { includeExistingLore: false },
    })

    expect(mockGrokGenerate).toHaveBeenCalledOnce()
    const content = getGrokCallUserContent()
    const fileAttachments = content.filter(c => c['type'] === 'input_file')
    expect(fileAttachments).toHaveLength(0)
  })

  it('does not attach file IDs from to_be_deleted lore nodes', async () => {
    testDbPath = setupDb({
      grokApiKey: 'grok-key',
      loreNodes: [
        {
          id: 1, parent_id: null, name: 'Deleted', word_count: 5, to_be_deleted: 1,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-deleted', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
        {
          id: 2, parent_id: null, name: 'Active', word_count: 5,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-active', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockGrokResponse()

    await request(app).post('/ai/generate-plan-children').send({
      prompt: 'Split into chapters',
      parentTitle: 'Act 1',
      settings: { includeExistingLore: true },
    })

    const content = getGrokCallUserContent()
    const fileAttachments = content.filter(c => c['type'] === 'input_file')
    expect(fileAttachments.some(f => f['file_id'] === 'file-active')).toBe(true)
    expect(fileAttachments.some(f => f['file_id'] === 'file-deleted')).toBe(false)
  })

  // ─── 3. isRoot / system prompt framing ────────────────────────────────────

  it('uses root-specific system prompt (not "detailed breakdown") when isRoot=true', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse()

    await request(app).post('/ai/generate-plan-children').send({
      prompt: 'Create outline',
      parentTitle: 'My Novel',
      isRoot: true,
    })

    const params = mockGrokGenerate.mock.calls[0][1] as { instructions: string }
    expect(params.instructions).not.toContain('detailed breakdown')
  })

  it('uses "detailed breakdown" framing in system prompt for non-root node', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse()

    await request(app).post('/ai/generate-plan-children').send({
      prompt: 'Split this section',
      parentTitle: 'Act 1',
      isRoot: false,
    })

    const params = mockGrokGenerate.mock.calls[0][1] as { instructions: string }
    expect(params.instructions).toContain('detailed breakdown')
    expect(params.instructions).toContain('Act 1')
  })

})
