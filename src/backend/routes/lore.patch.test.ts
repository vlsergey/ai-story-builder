/**
 * Integration tests for PATCH /lore/:id
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

const { default: router } = await import('./lore.js')

const app = express()
app.use(express.json())
app.use('/lore', router)

function setupDb(): string {
  const file = path.join(
    os.tmpdir(),
    `lore_patch_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file)
  db.exec(`
    CREATE TABLE lore_nodes (
      id                  INTEGER PRIMARY KEY,
      parent_id           INTEGER NULL REFERENCES lore_nodes(id) ON DELETE CASCADE,
      name                TEXT NOT NULL,
      content             TEXT,
      word_count          INTEGER NOT NULL DEFAULT 0,
      char_count          INTEGER NOT NULL DEFAULT 0,
      byte_count          INTEGER NOT NULL DEFAULT 0,
      ai_sync_info        TEXT NULL,
      content_updated_at  DATETIME NULL,
      position            INTEGER DEFAULT 0,
      status              TEXT NOT NULL DEFAULT 'ACTIVE',
      to_be_deleted       INTEGER NOT NULL DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (parent_id, name)
    );
    INSERT INTO lore_nodes (id, parent_id, name) VALUES
      (1, NULL, 'root'),
      (2, 1,    'chapter');
  `)
  db.close()
  return file
}

beforeEach(() => { testDbPath = setupDb() })
afterEach(() => { try { fs.unlinkSync(testDbPath) } catch { /* ignore */ } })

describe('PATCH /lore/:id', () => {
  it('returns updated word/char/byte counts when content is saved', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'Hello world from lore' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.word_count).toBe(4)
    expect(res.body.char_count).toBe(21)
    expect(res.body.byte_count).toBe(21)
  })

  it('returns content_updated_at when content is saved', async () => {
    const before = new Date().toISOString()
    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'Some new content' })

    expect(res.status).toBe(200)
    expect(res.body.content_updated_at).toBeDefined()
    expect(typeof res.body.content_updated_at).toBe('string')
    // SQLite CURRENT_TIMESTAMP has second precision; allow 1s of slack
    expect(new Date(res.body.content_updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000)
  })

  it('does not include stats in response when only name is updated', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ name: 'New Name' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.word_count).toBeUndefined()
  })

  it('does not return content_updated_at when only name is updated', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ name: 'New Name' })

    expect(res.status).toBe(200)
    expect(res.body.content_updated_at).toBeUndefined()
  })

  it('persists content_updated_at in DB when content is saved', async () => {
    await request(app).patch('/lore/2').send({ content: 'Some content' })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT content_updated_at FROM lore_nodes WHERE id = 2').get() as { content_updated_at: string | null }
    db.close()

    expect(row.content_updated_at).not.toBeNull()
  })
})
