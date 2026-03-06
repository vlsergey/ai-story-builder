import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { setCurrentDbPath } from '../db/state.js'
import plansRouter from './plans.js'

// ── In-memory DB setup ────────────────────────────────────────────────────────

function setupDb(dbPath: string) {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE plan_nodes (
      id          INTEGER PRIMARY KEY,
      parent_id   INTEGER NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      content     TEXT,
      position    INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      word_count  INTEGER NOT NULL DEFAULT 0,
      char_count  INTEGER NOT NULL DEFAULT 0,
      byte_count  INTEGER NOT NULL DEFAULT 0,
      changes_status TEXT NULL,
      review_base_content TEXT NULL,
      last_improve_instruction TEXT NULL,
      last_generate_prompt TEXT NULL
    );
  `)
  // Root + child
  db.prepare("INSERT INTO plan_nodes (id, parent_id, title, position) VALUES (1, NULL, 'Root', 0)").run()
  db.prepare("INSERT INTO plan_nodes (id, parent_id, title, position) VALUES (2, 1, 'Child', 0)").run()
  db.close()
}

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/plan', plansRouter)
  return app
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /plan/nodes/:id', () => {
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `plans-test-${Date.now()}.sqlite`)
    setupDb(dbPath)
    setCurrentDbPath(dbPath)
  })

  afterEach(() => {
    setCurrentDbPath(null)
    try { fs.unlinkSync(dbPath) } catch (_) {}
  })

  it('updates title', async () => {
    const app = makeApp()
    const res = await request(app)
      .patch('/plan/nodes/2')
      .send({ title: 'Updated Title' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const check = await request(app).get('/plan/nodes/2')
    expect(check.body.title).toBe('Updated Title')
  })

  it('updates content and returns counts', async () => {
    const app = makeApp()
    const res = await request(app)
      .patch('/plan/nodes/2')
      .send({ content: 'Hello world' })
    expect(res.status).toBe(200)
    expect(res.body.word_count).toBe(2)
    expect(res.body.char_count).toBe(11)
  })

  it('start_review sets changes_status and captures review_base_content', async () => {
    const app = makeApp()
    // First set some content
    await request(app).patch('/plan/nodes/2').send({ content: 'Original content' })
    // Now start review
    const res = await request(app).patch('/plan/nodes/2').send({
      content: 'Improved content',
      start_review: true,
      prompt: 'Make it better',
    })
    expect(res.status).toBe(200)

    const check = await request(app).get('/plan/nodes/2')
    expect(check.body.changes_status).toBe('review')
    expect(check.body.review_base_content).toBe('Original content')
    expect(check.body.last_improve_instruction).toBe('Make it better')
  })

  it('start_review on repeat does not overwrite review_base_content', async () => {
    const app = makeApp()
    await request(app).patch('/plan/nodes/2').send({ content: 'Base' })
    await request(app).patch('/plan/nodes/2').send({ content: 'First improve', start_review: true, prompt: 'first' })
    await request(app).patch('/plan/nodes/2').send({ content: 'Second improve', start_review: true, prompt: 'second' })

    const check = await request(app).get('/plan/nodes/2')
    expect(check.body.review_base_content).toBe('Base')
    expect(check.body.last_improve_instruction).toBe('second')
  })

  it('accept_review clears review state', async () => {
    const app = makeApp()
    await request(app).patch('/plan/nodes/2').send({ content: 'Base' })
    await request(app).patch('/plan/nodes/2').send({ content: 'Improved', start_review: true, prompt: 'fix it' })
    await request(app).patch('/plan/nodes/2').send({ content: 'Improved', accept_review: true })

    const check = await request(app).get('/plan/nodes/2')
    expect(check.body.changes_status).toBeNull()
    expect(check.body.review_base_content).toBeNull()
    expect(check.body.last_improve_instruction).toBeNull()
  })

  it('returns 400 when no fields provided', async () => {
    const app = makeApp()
    const res = await request(app).patch('/plan/nodes/2').send({})
    expect(res.status).toBe(400)
  })
})

describe('DELETE /plan/nodes/:id', () => {
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `plans-test-${Date.now()}.sqlite`)
    setupDb(dbPath)
    setCurrentDbPath(dbPath)
  })

  afterEach(() => {
    setCurrentDbPath(null)
    try { fs.unlinkSync(dbPath) } catch (_) {}
  })

  it('deletes a child node', async () => {
    const app = makeApp()
    const res = await request(app).delete('/plan/nodes/2')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const check = await request(app).get('/plan/nodes/2')
    expect(check.status).toBe(404)
  })

  it('refuses to delete root node', async () => {
    const app = makeApp()
    const res = await request(app).delete('/plan/nodes/1')
    expect(res.status).toBe(403)
  })
})
