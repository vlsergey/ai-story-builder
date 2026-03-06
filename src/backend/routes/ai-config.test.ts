/**
 * Integration tests for /api/ai/* endpoints
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

const { default: router } = await import('./ai-config.js')

const app = express()
app.use(express.json())
app.use('/ai', router)

function setupDb(): string {
  const file = path.join(
    os.tmpdir(),
    `ai_config_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file)
  db.exec(`
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  db.close()
  return file
}

beforeEach(() => { testDbPath = setupDb() })
afterEach(() => { try { fs.unlinkSync(testDbPath) } catch { /* ignore */ } })

// ── GET /api/ai/config ────────────────────────────────────────────────────────

describe('GET /ai/config', () => {
  it('returns defaults when nothing is saved', async () => {
    const res = await request(app).get('/ai/config')

    expect(res.status).toBe(200)
    expect(res.body.current_engine).toBeNull()
    expect(res.body.grok.api_key).toBe('')
    expect(res.body.yandex.api_key).toBe('')
    expect(res.body.yandex.folder_id).toBe('')
  })

  it('returns saved grok api_key', async () => {
    await request(app).post('/ai/config').send({ engine: 'grok', fields: { api_key: 'xai-test-key' } })
    const res = await request(app).get('/ai/config')

    expect(res.status).toBe(200)
    expect(res.body.grok.api_key).toBe('xai-test-key')
  })

  it('returns saved yandex credentials', async () => {
    await request(app).post('/ai/config').send({
      engine: 'yandex',
      fields: { api_key: 'AQVN-test', folder_id: 'b1g12345' },
    })
    const res = await request(app).get('/ai/config')

    expect(res.status).toBe(200)
    expect(res.body.yandex.api_key).toBe('AQVN-test')
    expect(res.body.yandex.folder_id).toBe('b1g12345')
  })

  it('returns null last_model when not set', async () => {
    const res = await request(app).get('/ai/config')
    expect(res.status).toBe(200)
    expect(res.body.grok.last_model).toBeNull()
    expect(res.body.yandex.last_model).toBeNull()
  })

  it('returns stored last_model for grok and yandex', async () => {
    await request(app).post('/ai/config').send({ engine: 'grok', fields: { last_model: 'grok-3' } })
    await request(app).post('/ai/config').send({ engine: 'yandex', fields: { last_model: 'gpt://b1g999/yandexgpt/latest' } })

    const res = await request(app).get('/ai/config')
    expect(res.status).toBe(200)
    expect(res.body.grok.last_model).toBe('grok-3')
    expect(res.body.yandex.last_model).toBe('gpt://b1g999/yandexgpt/latest')
  })

  it('returns extra fields saved via POST (e.g. settings object)', async () => {
    await request(app).post('/ai/config').send({
      engine: 'grok',
      fields: { settings: { model: 'grok-3', maxTokens: 4096, webSearch: 'none' } },
    })
    const res = await request(app).get('/ai/config')
    expect(res.status).toBe(200)
    expect(res.body.grok.settings).toEqual({ model: 'grok-3', maxTokens: 4096, webSearch: 'none' })
  })

  it('returns saved current_engine', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare("INSERT INTO settings (key, value) VALUES ('current_backend', 'grok')").run()
    db.close()

    const res = await request(app).get('/ai/config')
    expect(res.body.current_engine).toBe('grok')
  })
})

// ── POST /ai/config ───────────────────────────────────────────────────────────

describe('POST /ai/config', () => {
  it('saves grok api_key', async () => {
    const res = await request(app).post('/ai/config').send({
      engine: 'grok',
      fields: { api_key: 'xai-abc123' },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('saves yandex api_key and folder_id', async () => {
    const res = await request(app).post('/ai/config').send({
      engine: 'yandex',
      fields: { api_key: 'AQVN-abc', folder_id: 'b1g999' },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify persisted
    const cfg = await request(app).get('/ai/config')
    expect(cfg.body.yandex.api_key).toBe('AQVN-abc')
    expect(cfg.body.yandex.folder_id).toBe('b1g999')
  })

  it('merges fields without clobbering other fields', async () => {
    await request(app).post('/ai/config').send({
      engine: 'yandex',
      fields: { api_key: 'AQVN-abc', folder_id: 'b1g999' },
    })
    // Now update only api_key
    await request(app).post('/ai/config').send({
      engine: 'yandex',
      fields: { api_key: 'AQVN-new' },
    })
    const cfg = await request(app).get('/ai/config')
    expect(cfg.body.yandex.api_key).toBe('AQVN-new')
    expect(cfg.body.yandex.folder_id).toBe('b1g999')  // preserved
  })

  it('returns 400 when engine is missing', async () => {
    const res = await request(app).post('/ai/config').send({ fields: { api_key: 'x' } })
    expect(res.status).toBe(400)
  })
})

// ── POST /ai/current-engine ───────────────────────────────────────────────────

describe('POST /ai/current-engine', () => {
  it('returns 400 with missing field list when grok api_key not saved', async () => {
    const res = await request(app).post('/ai/current-engine').send({ engine: 'grok' })

    expect(res.status).toBe(400)
    expect(res.body.missing).toContain('api_key')
  })

  it('returns 400 for yandex when api_key or folder_id missing', async () => {
    await request(app).post('/ai/config').send({
      engine: 'yandex',
      fields: { api_key: 'AQVN-abc' },
      // folder_id NOT saved
    })
    const res = await request(app).post('/ai/current-engine').send({ engine: 'yandex' })

    expect(res.status).toBe(400)
    expect(res.body.missing).toContain('folder_id')
  })

  it('accepts valid grok engine selection', async () => {
    await request(app).post('/ai/config').send({
      engine: 'grok',
      fields: { api_key: 'xai-abc' },
    })
    const res = await request(app).post('/ai/current-engine').send({ engine: 'grok' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('accepts valid yandex engine selection', async () => {
    await request(app).post('/ai/config').send({
      engine: 'yandex',
      fields: { api_key: 'AQVN-abc', folder_id: 'b1g999' },
    })
    const res = await request(app).post('/ai/current-engine').send({ engine: 'yandex' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('clears engine when null is passed', async () => {
    // Set engine first
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare("INSERT INTO settings (key, value) VALUES ('current_backend', 'grok')").run()
    db.close()

    const res = await request(app).post('/ai/current-engine').send({ engine: null })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const cfg = await request(app).get('/ai/config')
    expect(cfg.body.current_engine).toBeNull()
  })
})

// ── POST /ai/:engine/test ─────────────────────────────────────────────────────

describe('POST /ai/:engine/test', () => {
  it('returns 400 when grok api_key is missing', async () => {
    const res = await request(app).post('/ai/grok/test').send({})
    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
  })

  it('returns 400 when yandex folder_id is missing', async () => {
    const res = await request(app).post('/ai/yandex/test').send({ api_key: 'AQVN-abc' })
    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
  })

  it('returns ok:false on grok HTTP error (mocked fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"message":"Unauthorized"}',
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/grok/test').send({ api_key: 'bad-key' })
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toContain('401')

    vi.unstubAllGlobals()
  })

  it('returns ok:true on grok success (mocked fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'grok-2' }, { id: 'grok-3' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/grok/test').send({ api_key: 'xai-valid' })
    expect(res.body.ok).toBe(true)
    expect(res.body.detail).toContain('2 model')

    vi.unstubAllGlobals()
  })

  it('returns ok:false on yandex HTTP error (mocked fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => '{"message":"Permission denied"}',
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app)
      .post('/ai/yandex/test')
      .send({ api_key: 'bad-key', folder_id: 'b1g999' })
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toContain('403')

    vi.unstubAllGlobals()
  })

  it('returns ok:true on yandex success (mocked fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'yandexgpt/latest' }, { id: 'yandexgpt-lite' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app)
      .post('/ai/yandex/test')
      .send({ api_key: 'AQVN-valid', folder_id: 'b1g999' })
    expect(res.body.ok).toBe(true)
    expect(res.body.detail).toContain('2 model')

    vi.unstubAllGlobals()
  })

  it('returns 400 for unknown engine', async () => {
    const res = await request(app).post('/ai/unknown/test').send({ api_key: 'x' })
    expect(res.status).toBe(400)
  })
})

// ── GET /ai/:engine/models ────────────────────────────────────────────────────

describe('GET /ai/:engine/models', () => {
  it('returns empty array when no models cached', async () => {
    const res = await request(app).get('/ai/yandex/models')
    expect(res.status).toBe(200)
    expect(res.body.models).toEqual([])
  })

  it('returns cached models after they are saved', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    const models = ['gpt://b1g999/yandexgpt/latest', 'gpt://b1g999/yandexgpt-lite/latest']
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_config', ?)").run(
      JSON.stringify({ yandex: { api_key: 'k', folder_id: 'b1g999', available_models: models } })
    )
    db.close()

    const res = await request(app).get('/ai/yandex/models')
    expect(res.status).toBe(200)
    expect(res.body.models).toEqual(models)
  })
})

// ── POST /ai/:engine/models/refresh ──────────────────────────────────────────

describe('POST /ai/:engine/models/refresh', () => {
  it('returns 400 when credentials are missing', async () => {
    const res = await request(app).post('/ai/yandex/models/refresh')
    expect(res.status).toBe(400)
  })

  it('fetches and saves yandex models (mocked fetch)', async () => {
    await request(app).post('/ai/config').send({
      engine: 'yandex',
      fields: { api_key: 'AQVN-valid', folder_id: 'b1g999' },
    })

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

    const res = await request(app).post('/ai/yandex/models/refresh')
    expect(res.status).toBe(200)
    expect(res.body.models).toEqual([
      'gpt://b1g999/yandexgpt/latest',
      'gpt://b1g999/yandexgpt-lite/latest',
    ])

    // Verify persisted in config
    const cfg = await request(app).get('/ai/config')
    expect(cfg.body.yandex.available_models).toEqual([
      'gpt://b1g999/yandexgpt/latest',
      'gpt://b1g999/yandexgpt-lite/latest',
    ])

    vi.unstubAllGlobals()
  })

  it('fetches and saves grok models (mocked fetch)', async () => {
    await request(app).post('/ai/config').send({
      engine: 'grok',
      fields: { api_key: 'xai-valid' },
    })

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'grok-2' }, { id: 'grok-3-mini' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await request(app).post('/ai/grok/models/refresh')
    expect(res.status).toBe(200)
    expect(res.body.models).toEqual(['grok-2', 'grok-3-mini'])

    vi.unstubAllGlobals()
  })

  it('returns 400 for unsupported engine', async () => {
    const res = await request(app).post('/ai/unknown/models/refresh')
    expect(res.status).toBe(400)
  })
})
