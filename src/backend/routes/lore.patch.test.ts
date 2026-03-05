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
      position            INTEGER DEFAULT 0,
      status              TEXT NOT NULL DEFAULT 'ACTIVE',
      to_be_deleted       INTEGER NOT NULL DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      changes_status      TEXT NULL,
      review_base_content TEXT NULL,
      UNIQUE (parent_id, name)
    );
    CREATE TABLE lore_versions (
      id           INTEGER PRIMARY KEY,
      lore_node_id INTEGER NOT NULL REFERENCES lore_nodes(id) ON DELETE CASCADE,
      version      INTEGER NOT NULL,
      content      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source       TEXT NOT NULL DEFAULT 'manual',
      prompt       TEXT NULL,
      response_id  TEXT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (lore_node_id, version)
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

  it('creates a manual lore_versions entry when content is saved', async () => {
    await request(app).patch('/lore/2').send({ content: 'First content' })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const rows = db.prepare('SELECT * FROM lore_versions WHERE lore_node_id = 2 ORDER BY version').all() as Array<{
      version: number; content: string; source: string; prompt: string | null; response_id: string | null
    }>
    db.close()

    expect(rows).toHaveLength(1)
    expect(rows[0].version).toBe(1)
    expect(rows[0].content).toBe('First content')
    expect(rows[0].source).toBe('manual')
    expect(rows[0].prompt).toBeNull()
    expect(rows[0].response_id).toBeNull()
  })

  it('increments version on each content save', async () => {
    await request(app).patch('/lore/2').send({ content: 'v1' })
    await request(app).patch('/lore/2').send({ content: 'v2' })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const rows = db.prepare('SELECT version FROM lore_versions WHERE lore_node_id = 2 ORDER BY version').all() as { version: number }[]
    db.close()

    expect(rows.map(r => r.version)).toEqual([1, 2])
  })

  it('creates an ai lore_versions entry with prompt and response_id when source is ai', async () => {
    await request(app).patch('/lore/2').send({
      content: 'AI content',
      source: 'ai',
      prompt: 'Describe a dragon',
      response_id: 'resp-abc123',
    })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const row = db.prepare('SELECT * FROM lore_versions WHERE lore_node_id = 2').get() as {
      content: string; source: string; prompt: string | null; response_id: string | null
    }
    db.close()

    expect(row.content).toBe('AI content')
    expect(row.source).toBe('ai')
    expect(row.prompt).toBe('Describe a dragon')
    expect(row.response_id).toBe('resp-abc123')
  })

  it('does not create a version when only name is updated', async () => {
    await request(app).patch('/lore/2').send({ name: 'New Name' })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const count = (db.prepare('SELECT COUNT(*) AS c FROM lore_versions WHERE lore_node_id = 2').get() as { c: number }).c
    db.close()

    expect(count).toBe(0)
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
      .send({ content: 'AI improved content', source: 'ai', prompt: 'Make it better', start_review: true })

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

  it('start_review also creates a version entry', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'AI content', source: 'ai', prompt: 'Improve', start_review: true })

    expect(res.status).toBe(200)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const rows = db.prepare('SELECT * FROM lore_versions WHERE lore_node_id = 2').all() as Array<{
      version: number; source: string; prompt: string | null
    }>
    db.close()

    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('ai')
    expect(rows[0].prompt).toBe('Improve')
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
      .send({ content: 'Second AI result', source: 'ai', start_review: true })

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

  it('skip_version updates content without creating a lore_versions entry', async () => {
    const res = await request(app)
      .patch('/lore/2')
      .send({ content: 'Edited during review', skip_version: true })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.word_count).toBe(3)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath, { readonly: true })
    const count = (db.prepare('SELECT COUNT(*) AS c FROM lore_versions WHERE lore_node_id = 2').get() as { c: number }).c
    const node = db.prepare('SELECT content FROM lore_nodes WHERE id = 2').get() as { content: string }
    db.close()

    expect(count).toBe(0)
    expect(node.content).toBe('Edited during review')
  })

  it('accept_review clears changes_status and review_base_content', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare("UPDATE lore_nodes SET changes_status = 'review', review_base_content = 'Old' WHERE id = 2").run()
    db.close()

    const res = await request(app)
      .patch('/lore/2')
      .send({ accept_review: true })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database2 = require('better-sqlite3')
    const db2 = new Database2(testDbPath, { readonly: true })
    const row = db2.prepare('SELECT changes_status, review_base_content FROM lore_nodes WHERE id = 2').get() as {
      changes_status: string | null; review_base_content: string | null
    }
    db2.close()

    expect(row.changes_status).toBeNull()
    expect(row.review_base_content).toBeNull()
  })

  it('accept_review with content creates a new version only if content differs from latest', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    // Set up: in review with an existing version
    db.prepare("UPDATE lore_nodes SET content = 'AI text', changes_status = 'review', review_base_content = 'Old text' WHERE id = 2").run()
    db.prepare("INSERT INTO lore_versions (lore_node_id, version, content, source) VALUES (2, 1, 'AI text', 'ai')").run()
    db.close()

    // Accept with the same content (no new version expected)
    const resSame = await request(app)
      .patch('/lore/2')
      .send({ accept_review: true, content: 'AI text' })
    expect(resSame.status).toBe(200)

    // Accept with different content (new version expected)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database2 = require('better-sqlite3')
    const db2 = new Database2(testDbPath)
    db2.prepare("UPDATE lore_nodes SET changes_status = 'review', review_base_content = 'Old text' WHERE id = 2").run()
    db2.close()

    const resDiff = await request(app)
      .patch('/lore/2')
      .send({ accept_review: true, content: 'Edited AI text' })
    expect(resDiff.status).toBe(200)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database3 = require('better-sqlite3')
    const db3 = new Database3(testDbPath, { readonly: true })
    const rows = db3.prepare('SELECT version, source FROM lore_versions WHERE lore_node_id = 2 ORDER BY version').all() as Array<{
      version: number; source: string
    }>
    db3.close()

    expect(rows).toHaveLength(2)
    expect(rows[1].source).toBe('manual')
  })
})
