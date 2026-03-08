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
      id                      INTEGER PRIMARY KEY,
      parent_id               INTEGER NULL REFERENCES lore_nodes(id) ON DELETE CASCADE,
      name                    TEXT NOT NULL,
      content                 TEXT,
      word_count              INTEGER NOT NULL DEFAULT 0,
      char_count              INTEGER NOT NULL DEFAULT 0,
      byte_count              INTEGER NOT NULL DEFAULT 0,
      ai_sync_info            TEXT NULL,
      position                INTEGER DEFAULT 0,
      status                  TEXT NOT NULL DEFAULT 'ACTIVE',
      to_be_deleted           INTEGER NOT NULL DEFAULT 0,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      changes_status          TEXT NULL,
      review_base_content     TEXT NULL,
      last_improve_instruction TEXT NULL,
      user_prompt             TEXT NULL,
      system_prompt           TEXT NULL,
      UNIQUE (parent_id, name)
    );
    INSERT INTO lore_nodes (id, parent_id, name, content) VALUES
      (1, NULL, 'root', NULL),
      (2, 1,    'chapter', NULL);
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

  it('does not include stats in response when only name is updated', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ name: 'New Name' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.word_count).toBeUndefined()
  })

  it('returns null ai_sync_info when node has no prior sync records', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'Some new content' })

    expect(res.status).toBe(200)
    expect(res.body.ai_sync_info).toBeNull()
  })

  it('returns updated ai_sync_info with content_updated_at when node has existing sync records', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare("UPDATE lore_nodes SET ai_sync_info = ? WHERE id = 2").run(
      JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'f1' } })
    )
    db.close()

    const before = new Date().toISOString()
    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'Updated content' })

    expect(res.status).toBe(200)
    expect(res.body.ai_sync_info).toBeDefined()
    expect(res.body.ai_sync_info.yandex).toBeDefined()
    expect(res.body.ai_sync_info.yandex.file_id).toBe('f1')
    expect(res.body.ai_sync_info.yandex.content_updated_at).toBeDefined()
    expect(new Date(res.body.ai_sync_info.yandex.content_updated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(before).getTime() - 1000)
  })

  it('does not return ai_sync_info when only name is updated', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ name: 'New Name' })

    expect(res.status).toBe(200)
    expect(res.body.ai_sync_info).toBeUndefined()
  })

  it('persists updated content_updated_at inside ai_sync_info in DB when content is saved', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare("UPDATE lore_nodes SET ai_sync_info = ? WHERE id = 2").run(
      JSON.stringify({ yandex: { last_synced_at: '2025-01-01T00:00:00.000Z', file_id: 'f1' } })
    )
    db.close()

    await request(app).patch('/lore/2').send({ content: 'Some content' })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database2 = require('better-sqlite3')
    const db2 = new Database2(testDbPath, { readonly: true })
    const row = db2.prepare('SELECT ai_sync_info FROM lore_nodes WHERE id = 2').get() as { ai_sync_info: string }
    db2.close()

    const syncInfo = JSON.parse(row.ai_sync_info) as { yandex: { content_updated_at?: string } }
    expect(syncInfo.yandex.content_updated_at).toBeDefined()
  })

  it('start_review captures current content as review_base_content and sets changes_status=review', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    // Pre-set existing content in the DB
    const db = new Database(testDbPath)
    db.prepare("UPDATE lore_nodes SET content = ? WHERE id = 2").run('Original content')
    db.close()

    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'AI improved content', prompt: 'Make it better', start_review: true })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database2 = require('better-sqlite3')
    const db2 = new Database2(testDbPath, { readonly: true })
    const row = db2.prepare('SELECT content, changes_status, review_base_content FROM lore_nodes WHERE id = 2').get() as {
      content: string; changes_status: string | null; review_base_content: string | null
    }
    db2.close()

    expect(row.content).toBe('AI improved content')
    expect(row.changes_status).toBe('review')
    expect(row.review_base_content).toBe('Original content')
  })

  it('start_review saves prompt as last_improve_instruction', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'New content', prompt: 'Make it epic', start_review: true })

    expect(res.status).toBe(200)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT last_improve_instruction FROM lore_nodes WHERE id = 2').get() as { last_improve_instruction: string | null }
    db.close()

    expect(row.last_improve_instruction).toBe('Make it epic')
  })

  it('start_review does not overwrite review_base_content when already in review', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare("UPDATE lore_nodes SET content = ?, changes_status = 'review', review_base_content = ? WHERE id = 2")
      .run('First AI result', 'Original content')
    db.close()

    // Second improvement (repeat): send start_review again with new AI content
    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'Second AI result', start_review: true })

    expect(res.status).toBe(200)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database2 = require('better-sqlite3')
    const db2 = new Database2(testDbPath, { readonly: true })
    const row = db2.prepare('SELECT review_base_content FROM lore_nodes WHERE id = 2').get() as {
      review_base_content: string | null
    }
    db2.close()

    // review_base_content must remain the original (not overwritten with 'First AI result')
    expect(row.review_base_content).toBe('Original content')
  })

  it('accept_review clears changes_status, review_base_content, and last_improve_instruction', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare("UPDATE lore_nodes SET changes_status = 'review', review_base_content = 'Old', last_improve_instruction = 'some instruction' WHERE id = 2").run()
    db.close()

    const res = await request(app)
      .patch('/lore/2')
      .send({ accept_review: true })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database2 = require('better-sqlite3')
    const db2 = new Database2(testDbPath, { readonly: true })
    const row = db2.prepare('SELECT changes_status, review_base_content, last_improve_instruction FROM lore_nodes WHERE id = 2').get() as {
      changes_status: string | null; review_base_content: string | null; last_improve_instruction: string | null
    }
    db2.close()

    expect(row.changes_status).toBeNull()
    expect(row.review_base_content).toBeNull()
    expect(row.last_improve_instruction).toBeNull()
  })
})
