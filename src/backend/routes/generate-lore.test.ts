/**
 * Integration tests for generateLore()
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { migrateDatabase } from '../db/migrations.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'
import { setCurrentDbPath } from '../db/state.js'
import { AiConfigStore } from '../../shared/ai-engine-config.js'
import Database from 'better-sqlite3'

let testDbPath = ''

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => testDbPath,
  setCurrentDbPath: (p: string | null) => { testDbPath = p ?? '' },
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

// ─── Import pure function ────────────────────────────────────────────────────

const { generateLore } = await import('./generate-lore.js')

// ─── DB helper ────────────────────────────────────────────────────────────────

function setupDb(opts?: {
  currentEngine?: string
  yandexApiKey?: string
  folderId?: string
  searchIndexId?: string
  grokApiKey?: string
  /** Pass null to explicitly omit text_language from the DB (to test the "not configured" error). */
  textLanguage?: string | null
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
  const db = new Database(file)
  migrateDatabase(db)
  db.close()

  // Set current DB path so repositories can find it
  setCurrentDbPath(file)

  const engine = opts?.currentEngine
    ?? (opts?.grokApiKey ? 'grok' : opts?.yandexApiKey ? 'yandex' : undefined)
  if (engine) {
    SettingsRepository.setCurrentBackend(engine)
  }

  const aiConfig: AiConfigStore = {}
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
    SettingsRepository.saveAiConfig(aiConfig)
  }

  // Default to 'ru-RU' so tests don't need to specify it explicitly.
  // Pass null to leave text_language unset (for testing the "not configured" error).
  const lang = opts?.textLanguage !== undefined ? opts.textLanguage : 'ru-RU'
  if (lang !== null) {
    SettingsRepository.setTextLanguage(lang)
  }

  const loreRepo = new LoreNodeRepository()
  for (const n of opts?.nodes ?? []) {
    loreRepo.insert({
      id: n.id,
      parent_id: n.parent_id ?? null,
      name: n.name,
      content: n.content ?? null,
      word_count: n.word_count ?? 0,
      to_be_deleted: n.to_be_deleted ?? 0,
      ai_sync_info: n.ai_sync_info ?? null,
    })
  }

  return file
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockYandexResponse(content = JSON.stringify({ name: 'Lore item', content: 'Generated lore text' })) {
  mockChatCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  })
}

function mockGrokResponse(content = JSON.stringify({ name: 'Lore item', content: 'Generated lore text' })) {
  mockGrokGenerate.mockImplementationOnce(
    async (_apiKey: string, _params: Record<string, unknown>, _onThinking?: (status: string) => void, onDelta?: (text: string) => void) => {
      onDelta?.(content)
      return { text: content, response_id: 'test-response-id' }
    }
  )
}

async function callGenerateLore(params: Record<string, unknown>) {
  const partials: Record<string, unknown>[] = []
  const thinkings: { status: string; detail?: string }[] = []
  const onThinking = (status: string, detail?: string) => thinkings.push({ status, detail })
  const onPartialJson = (data: Record<string, unknown>) => partials.push(data)
  const result = await generateLore(params as any, onThinking, onPartialJson)
  return { result, partials, thinkings }
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

describe('generateLore', () => {

  // ─── 1. Basic validation ───────────────────────────────────────────────────

  it('throws 400 when no project open', async () => {
    testDbPath = ''
    await expect(callGenerateLore({ prompt: 'test' })).rejects.toThrow(/no project open/)
    try { await callGenerateLore({ prompt: 'test' }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when prompt is missing', async () => {
    testDbPath = setupDb({ grokApiKey: 'key' })
    await expect(callGenerateLore({})).rejects.toThrow(/prompt is required/)
    try { await callGenerateLore({}) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when no AI engine is configured', async () => {
    testDbPath = setupDb() // no engine
    await expect(callGenerateLore({ prompt: 'hello' })).rejects.toThrow(/no AI engine configured/)
    try { await callGenerateLore({ prompt: 'hello' }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 for an unknown engine id', async () => {
    testDbPath = setupDb({ currentEngine: 'unknown-engine' })
    await expect(callGenerateLore({ prompt: 'hello' })).rejects.toThrow(/not supported for engine 'unknown-engine'/)
    try { await callGenerateLore({ prompt: 'hello' }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  // ─── 2. Grok — basic generation ───────────────────────────────────────────

  it('returns generated content for Grok engine via onPartialJson', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse(JSON.stringify({ name: 'Arin', content: 'A brave hero named Arin.' }))

    const { partials } = await callGenerateLore({ prompt: 'Describe a hero' })
    const last = partials[partials.length - 1]
    expect(last.name).toBe('Arin')
    expect(last.content).toBe('A brave hero named Arin.')
  })

  it('throws when Grok api_key is missing', async () => {
    testDbPath = setupDb({ currentEngine: 'grok' }) // no grokApiKey in config
    await expect(callGenerateLore({ prompt: 'test' })).rejects.toThrow(/Grok api_key is required/)
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
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-abc123', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockGrokResponse('Hero content')

    await callGenerateLore({ prompt: 'Describe a hero', settings: { includeExistingLore: true } })

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

  it('includes file IDs from group-leader nodes with word_count=0', async () => {
    testDbPath = setupDb({
      grokApiKey: 'grok-key',
      nodes: [
        { id: 1, parent_id: null, name: 'Root', word_count: 0, ai_sync_info: null },
        {
          id: 2, parent_id: 1, name: 'Characters', word_count: 0,
          ai_sync_info: JSON.stringify({ grok: { file_id: 'file-leader', last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
        {
          id: 3, parent_id: 2, name: 'Hero', word_count: 5,
          ai_sync_info: JSON.stringify({ grok: { merged_into_parent: true, last_synced_at: '2025-01-01T00:00:00Z' } }),
        },
      ],
    })
    mockGrokResponse('Hero lore')

    await callGenerateLore({ prompt: 'Tell me about the hero', settings: { includeExistingLore: true } })

    expect(mockGrokGenerate).toHaveBeenCalledOnce()
    const params = mockGrokGenerate.mock.calls[0][1] as {
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>
    }
    const userMessage = params.input.find((m) => m.role === 'user')
    const fileAttachments = userMessage!.content.filter(c => c.type === 'input_file')

    expect(fileAttachments.some(f => f.file_id === 'file-leader')).toBe(true)
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

    await callGenerateLore({ prompt: 'test', settings: { includeExistingLore: true } })

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

    await callGenerateLore({ prompt: 'test', settings: { includeExistingLore: false } })

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

    const { partials } = await callGenerateLore({ prompt: 'Create a world' })
    const last = partials[partials.length - 1]
    expect(last.name).toBe('World')
    expect(last.content).toBe('Yandex lore result')
  })

  it('throws when Yandex api_key or folder_id is missing', async () => {
    testDbPath = setupDb({ currentEngine: 'yandex' }) // no credentials
    await expect(callGenerateLore({ prompt: 'test' })).rejects.toThrow(/Yandex api_key and folder_id are required/)
  })

  // ─── 6. text_language setting ─────────────────────────────────────────────

  it('uses text_language from settings in the system prompt', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key', textLanguage: 'en-US' })
    mockGrokResponse()

    await callGenerateLore({ prompt: 'Describe a wizard' })

    const params = mockGrokGenerate.mock.calls[0][1] as { instructions: string }
    expect(params.instructions).toContain('en-US')
  })

  it('throws 400 when text_language is not configured', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key', textLanguage: null })
    await expect(callGenerateLore({ prompt: 'Describe a hero' })).rejects.toThrow(/text_language is not configured/)
    try { await callGenerateLore({ prompt: 'Describe a hero' }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  // ─── 7. Grok web search ────────────────────────────────────────────────────

  it('passes web_search tool to Grok when webSearch is enabled', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse('Lore with web info')

    await callGenerateLore({ prompt: 'News', settings: { webSearch: 'on' } })

    const params = mockGrokGenerate.mock.calls[0][1] as { tools?: unknown[] }
    expect(params.tools).toEqual([{ type: 'web_search' }])
  })

  it('does not pass tools to Grok when webSearch is none', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse('Normal lore')

    await callGenerateLore({ prompt: 'Something', settings: { webSearch: 'none' } })

    const params = mockGrokGenerate.mock.calls[0][1] as { tools?: unknown[] }
    expect(params.tools).toBeUndefined()
  })

  // ─── 8. Structured JSON output ─────────────────────────────────────────────

  it('emits partial_json callbacks (not delta) for Grok', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    const jsonResponse = JSON.stringify({ name: 'Arin the Brave', content: '## Hero\nA brave warrior.' })
    mockGrokResponse(jsonResponse)

    const { partials } = await callGenerateLore({ prompt: 'Describe a hero' })

    const last = partials[partials.length - 1]
    expect(last.name).toBe('Arin the Brave')
    expect(last.content).toBe('## Hero\nA brave warrior.')

    const params = mockGrokGenerate.mock.calls[0][1] as { text?: { format?: { type?: string } } }
    expect(params.text?.format?.type).toBe('json_schema')
  })

  // ─── 9. Improve mode ──────────────────────────────────────────────────────

  it('includes baseContent in system prompt when mode=improve', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse()

    await callGenerateLore({
      prompt: 'Make it longer',
      mode: 'improve',
      baseContent: 'A short hero description.',
    })

    const params = mockGrokGenerate.mock.calls[0][1] as {
      instructions: string
      input: Array<{ role: string; content: Array<{ type: string; text?: string }> }>
    }
    expect(params.instructions).toContain('Improve the following lore item')
    expect(params.instructions).toContain('A short hero description.')
    const userText = params.input.find(m => m.role === 'user')?.content.find(c => c.type === 'input_text')?.text
    expect(userText).toContain('Make it longer')
  })

  it('uses generate system prompt when mode=generate (default)', async () => {
    testDbPath = setupDb({ grokApiKey: 'grok-key' })
    mockGrokResponse()

    await callGenerateLore({ prompt: 'Create a wizard' })

    const params = mockGrokGenerate.mock.calls[0][1] as { instructions: string }
    expect(params.instructions).toContain('Generate a lore item')
    expect(params.instructions).not.toContain('Improve')
  })

  it('emits partial_json callbacks for Yandex', async () => {
    testDbPath = setupDb({ yandexApiKey: 'yandex-key', folderId: 'folder-1' })
    const jsonResponse = JSON.stringify({ name: 'Mystic Forest', content: '## Forest\nA place of wonder.' })
    mockYandexResponse(jsonResponse)

    const { partials } = await callGenerateLore({ prompt: 'Describe a location' })

    const last = partials[partials.length - 1]
    expect(last.name).toBe('Mystic Forest')
    expect(last.content).toBe('## Forest\nA place of wonder.')

    const params = mockChatCreate.mock.calls[0][0] as { response_format?: { type?: string } }
    expect(params.response_format?.type).toBe('json_schema')
  })
})
