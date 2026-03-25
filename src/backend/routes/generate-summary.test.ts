/**
 * Integration tests for generateSummary()
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { migrateDatabase } from '../db/migrations.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { PlanNodeRepository } from '../plan/nodes/plan-node-repository.js'
import { setCurrentDbPath } from '../db/state.js'
import { AllAiEnginesConfig } from '../../shared/ai-engine-config.js'
import Database from 'better-sqlite3'

let testDbPath = ''

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => testDbPath,
  getDataDir: () => '/tmp/test-data',
  restoreLastOpenedProject: () => null,
  setCurrentDbPath: (p: string | null) => { testDbPath = p ?? '' },
}))

// ─── AI engine adapter mock ──────────────────────────────────────────────────

const { mockGenerateResponse } = vi.hoisted(() => ({
  mockGenerateResponse: vi.fn(),
}))

vi.mock('../lib/ai-engine-adapter.js', () => ({
  getEngineAdapter: () => ({
    generateResponse: mockGenerateResponse,
  }),
  BUILTIN_ENGINES: [],
}))

vi.mock('../../shared/ai-engines.js', () => ({
  BUILTIN_ENGINES: [{ id: 'grok', capabilities: {} }, { id: 'yandex', capabilities: {} }],
}))

const { generateSummary } = await import('./generate-summary.js')

// ─── DB helper ───────────────────────────────────────────────────────────────

function setupDb(opts?: {
  currentEngine?: string
  yandexApiKey?: string
  folderId?: string
  grokApiKey?: string
  textLanguage?: string | null
  autoGenerateSummary?: boolean
  summarySettings?: Record<string, unknown>
  generateSummaryInstructions?: string
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

  const aiConfig: AllAiEnginesConfig = {}
  if (opts?.yandexApiKey || opts?.folderId) {
    const yandex: Record<string, string> = {}
    if (opts.yandexApiKey) yandex['api_key'] = opts.yandexApiKey
    if (opts.folderId) yandex['folder_id'] = opts.folderId
    aiConfig['yandex'] = yandex
  }
  if (opts?.grokApiKey) {
    aiConfig['grok'] = { api_key: opts.grokApiKey }
  }
  if (opts?.summarySettings && engine) {
    if (!aiConfig[engine]) {
      aiConfig[engine] = {}
    }
    (aiConfig[engine] as Record<string, unknown>).summary_settings = opts.summarySettings
  }
  // Add generateSummaryInstructions if provided, otherwise set a default
  if (engine) {
    if (!aiConfig[engine]) {
      aiConfig[engine] = {}
    }
    const instructions = opts?.generateSummaryInstructions ?? 'Summarize the following content:'
    ;(aiConfig[engine] as Record<string, unknown>).generateSummaryInstructions = instructions
  }
  if (Object.keys(aiConfig).length > 0) {
    SettingsRepository.saveAllAiEnginesConfig(aiConfig)
  }

  const lang = opts?.textLanguage !== undefined ? opts.textLanguage : 'ru-RU'
  if (lang !== null) {
    SettingsRepository.setTextLanguage(lang)
  }

  const autoGenerate = opts?.autoGenerateSummary ?? true
  SettingsRepository.setAutoGenerateSummary(autoGenerate)

  if (opts?.planNode) {
    const repo = new PlanNodeRepository()
    repo.insert({
      title: 'Test Node',
      type: 'text',
      content: opts.planNode.content ?? null,
      summary: opts.planNode.summary ?? null,
      auto_summary: opts.planNode.auto_summary ?? 0,
      parent_id: null,
      position: 0,
      x: 0,
      y: 0,
      ai_instructions: null,
      ai_sync_info: null,
      node_type_settings: null,
      ai_settings: null,
      word_count: 0,
      char_count: 0,
      byte_count: 0,
      status: 'EMPTY',
      changes_status: null,
      review_base_content: null,
      last_improve_instruction: null,
    })
    // inserted id will be 1 (first row)
  }

  return file
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

describe('generateSummary', () => {
  it('throws 400 when no project open', async () => {
    testDbPath = ''
    await expect(generateSummary({ node_id: 1 })).rejects.toThrow(/no project open/)
    try { await generateSummary({ node_id: 1 }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when node_id is missing', async () => {
    testDbPath = setupDb({ grokApiKey: 'key' })
    await expect(generateSummary({})).rejects.toThrow(/node_id is required/)
    try { await generateSummary({}) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when no AI engine configured', async () => {
    testDbPath = setupDb() // no engine
    await expect(generateSummary({ node_id: 1 })).rejects.toThrow(/no AI engine configured/)
    try { await generateSummary({ node_id: 1 }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 when plan node content is empty', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      planNode: { id: 1, content: '' },
    })
    await expect(generateSummary({ node_id: 1 })).rejects.toThrow(/plan node content is empty/)
    try { await generateSummary({ node_id: 1 }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('returns JSON response and updates node summary', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      planNode: { id: 1, content: 'A long story about a hero.' },
    })

    mockGenerateResponse.mockImplementationOnce(async (params: any, onThinking: any, onDelta: any) => {
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

    const result = await generateSummary({ node_id: 1 })
    expect(result.summary).toBe('Summary text')
    expect(result.response_id).toBe('resp-123')
    expect(result.tokens_input).toBe(10)
    expect(result.tokens_output).toBe(5)
    expect(result.tokens_total).toBe(15)
    expect(result.cached_tokens).toBe(0)
    expect(result.reasoning_tokens).toBe(0)
    expect(result.cost_usd_ticks).toBe(100)

    // Verify that the node was updated
    const nodeRepo = new PlanNodeRepository()
    const node = nodeRepo.getById(1)
    expect(node).toBeDefined()
    expect(node?.auto_summary).toBe(1)
    expect(node?.summary).toBe('Summary text')
  })

  it('uses content from params if provided', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      planNode: { id: 1, content: 'Old content' },
    })

    mockGenerateResponse.mockImplementationOnce(async (params: any, onThinking: any, onDelta: any) => {
      onDelta?.('Summary text')
      return { response_id: 'resp-456', tokensInput: 0, tokensOutput: 0, tokensTotal: 0, cachedTokens: 0, reasoningTokens: 0, costUsdTicks: 0 }
    })

    await generateSummary({ node_id: 1, content: 'New content for summary' })

    expect(mockGenerateResponse).toHaveBeenCalledOnce()
    const call = mockGenerateResponse.mock.calls[0]
    const params = call[0]
    expect(params.instructions).toContain('New content for summary')
  })

  it('respects auto_generate_summary setting (false) — still generates when called directly', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      autoGenerateSummary: false,
      planNode: { id: 1, content: 'Some content' },
    })

    mockGenerateResponse.mockImplementationOnce(async (params: any, onThinking: any, onDelta: any) => {
      onDelta?.('Summary text')
      return { response_id: 'resp-789', tokensInput: 0, tokensOutput: 0, tokensTotal: 0, cachedTokens: 0, reasoningTokens: 0, costUsdTicks: 0 }
    })

    const result = await generateSummary({ node_id: 1 })
    expect(result.summary).toBe('Summary text')
    expect(mockGenerateResponse).toHaveBeenCalledOnce()
  })

  it('stores plain text summary (not JSON) when adapter returns plain text', async () => {
    testDbPath = setupDb({
      grokApiKey: 'key',
      planNode: { id: 1, content: 'Some content' },
    })

    mockGenerateResponse.mockImplementationOnce(async (params: any, onThinking: any, onDelta: any) => {
      onDelta?.('A plain text summary')
      return { response_id: 'resp-xyz', tokensInput: 0, tokensOutput: 0, tokensTotal: 0, cachedTokens: 0, reasoningTokens: 0, costUsdTicks: 0 }
    })

    const result = await generateSummary({ node_id: 1 })
    expect(result.summary).toBe('A plain text summary')
    expect(result.response_id).toBe('resp-xyz')

    const nodeRepo = new PlanNodeRepository()
    const node = nodeRepo.getById(1)
    expect(node).toBeDefined()
    expect(node?.auto_summary).toBe(1)
    expect(node?.summary).toBe('A plain text summary')
    expect(() => JSON.parse(node!.summary!)).toThrow()
  })
})
