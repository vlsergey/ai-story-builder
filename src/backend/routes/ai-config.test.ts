/**
 * Integration tests for ai-config pure functions
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { migrateDatabase } from '../db/migrations.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import Database from 'better-sqlite3'

let testDbPath = ''

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => testDbPath,
  getDataDir: () => os.tmpdir(),
}))

const { getAiConfig, saveAiConfig, setCurrentEngine, getEngineModels, refreshEngineModels, testEngineConnection } = await import('./ai-config.js')

function setupDb(): string {
  const file = path.join(
    os.tmpdir(),
    `ai_config_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
  )
  const db = new Database(file)
  migrateDatabase(db)
  db.close()
  return file
}

beforeEach(() => { testDbPath = setupDb() })
afterEach(() => { try { fs.unlinkSync(testDbPath) } catch { /* ignore */ } })

// ── getAiConfig ────────────────────────────────────────────────────────────────

describe('getAiConfig', () => {
  it('returns defaults when nothing is saved', () => {
    const res = getAiConfig()

    expect(res.current_engine).toBeNull()
    expect((res.grok as any).api_key).toBe('')
    expect((res.yandex as any).api_key).toBe('')
    expect((res.yandex as any).folder_id).toBe('')
  })

  it('returns saved grok api_key', () => {
    saveAiConfig({ engine: 'grok', fields: { api_key: 'xai-test-key' } })
    const res = getAiConfig()

    expect((res.grok as any).api_key).toBe('xai-test-key')
  })

  it('returns saved yandex credentials', () => {
    saveAiConfig({ engine: 'yandex', fields: { api_key: 'AQVN-test', folder_id: 'b1g12345' } })
    const res = getAiConfig()

    expect((res.yandex as any).api_key).toBe('AQVN-test')
    expect((res.yandex as any).folder_id).toBe('b1g12345')
  })

  it('returns extra fields saved via saveAiConfig (e.g. settings object)', () => {
    saveAiConfig({ engine: 'grok', fields: { settings: { model: 'grok-3', maxTokens: 4096, webSearch: 'none' } } })
    const res = getAiConfig()
    expect((res.grok as any).settings).toEqual({ model: 'grok-3', maxTokens: 4096, webSearch: 'none' })
  })

  it('returns saved current_engine', () => {
    SettingsRepository.set('current_backend', 'grok')

    const res = getAiConfig()
    expect(res.current_engine).toBe('grok')
  })
})

// ── saveAiConfig ───────────────────────────────────────────────────────────────

describe('saveAiConfig', () => {
  it('saves grok api_key', () => {
    const res = saveAiConfig({ engine: 'grok', fields: { api_key: 'xai-abc123' } })
    expect(res.ok).toBe(true)
  })

  it('saves yandex api_key and folder_id', () => {
    const res = saveAiConfig({ engine: 'yandex', fields: { api_key: 'AQVN-abc', folder_id: 'b1g999' } })
    expect(res.ok).toBe(true)

    const cfg = getAiConfig()
    expect((cfg.yandex as any).api_key).toBe('AQVN-abc')
    expect((cfg.yandex as any).folder_id).toBe('b1g999')
  })

  it('merges fields without clobbering other fields', () => {
    saveAiConfig({ engine: 'yandex', fields: { api_key: 'AQVN-abc', folder_id: 'b1g999' } })
    saveAiConfig({ engine: 'yandex', fields: { api_key: 'AQVN-new' } })
    const cfg = getAiConfig()
    expect((cfg.yandex as any).api_key).toBe('AQVN-new')
    expect((cfg.yandex as any).folder_id).toBe('b1g999')  // preserved
  })

  it('throws 400 when engine is missing', () => {
    expect(() => saveAiConfig({ engine: '', fields: { api_key: 'x' } })).toThrow()
    try { saveAiConfig({ engine: '', fields: { api_key: 'x' } }) } catch (e: any) { expect(e.status).toBe(400) }
  })
})

// ── setCurrentEngine ───────────────────────────────────────────────────────────

describe('setCurrentEngine', () => {
  it('throws 400 with missing field list when grok api_key not saved', () => {
    expect(() => setCurrentEngine({ engine: 'grok' })).toThrow(/api_key/)
    try { setCurrentEngine({ engine: 'grok' }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('throws 400 for yandex when api_key or folder_id missing', () => {
    saveAiConfig({ engine: 'yandex', fields: { api_key: 'AQVN-abc' } })
    expect(() => setCurrentEngine({ engine: 'yandex' })).toThrow(/folder_id/)
    try { setCurrentEngine({ engine: 'yandex' }) } catch (e: any) { expect(e.status).toBe(400) }
  })

  it('accepts valid grok engine selection', () => {
    saveAiConfig({ engine: 'grok', fields: { api_key: 'xai-abc' } })
    const res = setCurrentEngine({ engine: 'grok' })
    expect(res.ok).toBe(true)
  })

  it('accepts valid yandex engine selection', () => {
    saveAiConfig({ engine: 'yandex', fields: { api_key: 'AQVN-abc', folder_id: 'b1g999' } })
    const res = setCurrentEngine({ engine: 'yandex' })
    expect(res.ok).toBe(true)
  })

  it('clears engine when null is passed', () => {
    SettingsRepository.set('current_backend', 'grok')

    const res = setCurrentEngine({ engine: null })
    expect(res.ok).toBe(true)

    const cfg = getAiConfig()
    expect(cfg.current_engine).toBeNull()
  })
})

// ── testEngineConnection ───────────────────────────────────────────────────────

describe('testEngineConnection', () => {
  it('throws 400 when grok api_key is missing', async () => {
    await expect(testEngineConnection('grok', {})).rejects.toThrow(/api_key/)
  })

  it('throws 400 when yandex folder_id is missing', async () => {
    await expect(testEngineConnection('yandex', { api_key: 'AQVN-abc' })).rejects.toThrow(/folder_id/)
  })

  it('returns ok:false on grok HTTP error (mocked fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"message":"Unauthorized"}',
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await testEngineConnection('grok', { api_key: 'bad-key' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('401')

    vi.unstubAllGlobals()
  })

  it('returns ok:true on grok success (mocked fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'grok-2' }, { id: 'grok-3' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await testEngineConnection('grok', { api_key: 'xai-valid' })
    expect(res.ok).toBe(true)
    expect(res.detail).toContain('2 model')

    vi.unstubAllGlobals()
  })

  it('returns ok:false on yandex HTTP error (mocked fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => '{"message":"Permission denied"}',
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await testEngineConnection('yandex', { api_key: 'bad-key', folder_id: 'b1g999' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('403')

    vi.unstubAllGlobals()
  })

  it('returns ok:true on yandex success (mocked fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'yandexgpt/latest' }, { id: 'yandexgpt-lite' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await testEngineConnection('yandex', { api_key: 'AQVN-valid', folder_id: 'b1g999' })
    expect(res.ok).toBe(true)
    expect(res.detail).toContain('2 model')

    vi.unstubAllGlobals()
  })

  it('returns ok:false for unknown engine', async () => {
    const res = await testEngineConnection('unknown', { api_key: 'x' })
    expect(res.ok).toBe(false)
  })
})

// ── getEngineModels ────────────────────────────────────────────────────────────

describe('getEngineModels', () => {
  it('returns empty array when no models cached', () => {
    const res = getEngineModels('yandex')
    expect(res.models).toEqual([])
  })

  it('returns cached models after they are saved', () => {
    const models = ['gpt://b1g999/yandexgpt/latest', 'gpt://b1g999/yandexgpt-lite/latest']
    SettingsRepository.setJson('ai_config', { yandex: { api_key: 'k', folder_id: 'b1g999', available_models: models } })

    const res = getEngineModels('yandex')
    expect(res.models).toEqual(models)
  })
})

// ── refreshEngineModels ────────────────────────────────────────────────────────

describe('refreshEngineModels', () => {
  it('throws 400 when credentials are missing', async () => {
    await expect(refreshEngineModels('yandex')).rejects.toThrow()
  })

  it('fetches and saves yandex models (mocked fetch)', async () => {
    saveAiConfig({ engine: 'yandex', fields: { api_key: 'AQVN-valid', folder_id: 'b1g999' } })

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt://b1g999/yandexgpt/latest' },
          { id: 'gpt://b1g999/yandexgpt-lite/latest' },
          { id: 'some-other-model' },   // non-gpt:// prefix — filtered out
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await refreshEngineModels('yandex')
    expect(res.models).toEqual([
      'gpt://b1g999/yandexgpt/latest',
      'gpt://b1g999/yandexgpt-lite/latest',
    ])

    const cfg = getAiConfig()
    expect((cfg.yandex as any).available_models).toEqual([
      'gpt://b1g999/yandexgpt/latest',
      'gpt://b1g999/yandexgpt-lite/latest',
    ])

    vi.unstubAllGlobals()
  })

  it('fetches and saves grok models (mocked fetch)', async () => {
    saveAiConfig({ engine: 'grok', fields: { api_key: 'xai-valid' } })

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'grok-2' }, { id: 'grok-3-mini' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await refreshEngineModels('grok')
    expect(res.models).toEqual(['grok-2', 'grok-3-mini'])

    vi.unstubAllGlobals()
  })

  it('throws 400 for unsupported engine', async () => {
    await expect(refreshEngineModels('unknown')).rejects.toThrow()
    try { await refreshEngineModels('unknown') } catch (e: any) { expect(e.status).toBe(400) }
  })
})
