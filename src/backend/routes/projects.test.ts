/**
 * Integration tests for /api/project/* endpoints
 * (routes that do not require an open database)
 */

import express from 'express'
import request from 'supertest'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mutable app settings store shared across the module mock
const mockSettings: { recent: string[]; lastOpenedPath?: string } = { recent: [] }

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => null,
  setCurrentDbPath: vi.fn(),
  readAppSettings: () => mockSettings,
  writeAppSettings: (s: typeof mockSettings) => {
    mockSettings.recent = s.recent ?? []
    mockSettings.lastOpenedPath = s.lastOpenedPath
  },
  getDataDir: () => '/tmp/test-data',
}))

vi.mock('../lib/yandex-client.js', () => ({ setVerboseLogging: vi.fn() }))

const { default: router } = await import('./projects.js')

const app = express()
app.use(express.json())
app.use('/project', router)

beforeEach(() => {
  mockSettings.recent = []
  delete mockSettings.lastOpenedPath
})

// ── DELETE /project/recent ────────────────────────────────────────────────────

describe('DELETE /project/recent', () => {
  it('removes the specified path from the recent list', async () => {
    mockSettings.recent = ['/data/a.sqlite', '/data/b.sqlite', '/data/c.sqlite']

    const res = await request(app)
      .delete('/project/recent')
      .send({ path: '/data/b.sqlite' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(mockSettings.recent).toEqual(['/data/a.sqlite', '/data/c.sqlite'])
  })

  it('is a no-op when path is not in the recent list', async () => {
    mockSettings.recent = ['/data/a.sqlite']

    const res = await request(app)
      .delete('/project/recent')
      .send({ path: '/data/nonexistent.sqlite' })

    expect(res.status).toBe(200)
    expect(mockSettings.recent).toEqual(['/data/a.sqlite'])
  })

  it('returns 400 when path is missing', async () => {
    const res = await request(app).delete('/project/recent').send({})

    expect(res.status).toBe(400)
  })
})
