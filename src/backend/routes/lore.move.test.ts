/**
 * Integration tests for POST /lore/:id/move
 *
 * Invalid move cases covered:
 *   - root node cannot be moved (403)
 *   - node to itself (400)
 *   - node to its direct child (400 — cycle)
 *   - node to a deeper descendant (400 — cycle)
 *   - non-existent node (404)
 *   - non-existent target parent (400)
 *
 * Valid cases:
 *   - move to a sibling's parent (reparent)
 *   - move to a different branch
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import express from 'express'
import request from 'supertest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Mock state so the router uses our temp DB ──────────────────────────────

let testDbPath = ''

vi.mock('../db/state.js', () => ({
  getCurrentDbPath: () => testDbPath,
  getDataDir: () => os.tmpdir(),
}))

// Import router AFTER mock is registered
const { default: router } = await import('./lore.js')

const app = express()
app.use(express.json())
app.use('/lore', router)

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Creates a fresh in-memory-style temp SQLite file with a small tree:
 *
 *   1 root  (parent_id = NULL)
 *   ├─ 2 child-a
 *   │  └─ 4 grandchild
 *   └─ 3 child-b
 */
function setupDb(): string {
  // Use a unique temp file per test
  const file = path.join(os.tmpdir(), `lore_move_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`)

  // Inline require because better-sqlite3 is a CJS optional dep
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file)

  db.exec(`
    CREATE TABLE lore_nodes (
      id             INTEGER PRIMARY KEY,
      parent_id      INTEGER NULL REFERENCES lore_nodes(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      position       INTEGER DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'ACTIVE',
      to_be_deleted  INTEGER NOT NULL DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (parent_id, name)
    );
    INSERT INTO lore_nodes (id, parent_id, name) VALUES
      (1, NULL,  'root'),
      (2, 1,     'child-a'),
      (3, 1,     'child-b'),
      (4, 2,     'grandchild');
  `)
  db.close()
  return file
}

function parentOf(file: string, id: number): number | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(file, { readonly: true })
  const row = db.prepare('SELECT parent_id FROM lore_nodes WHERE id = ?').get(id) as { parent_id: number | null }
  db.close()
  return row?.parent_id ?? null
}

// ── Test lifecycle ─────────────────────────────────────────────────────────

beforeEach(() => {
  testDbPath = setupDb()
})

afterEach(() => {
  try { fs.unlinkSync(testDbPath) } catch { /* ignore */ }
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /lore/:id/move — invalid cases', () => {

  it('403 when moving the root node', async () => {
    const res = await request(app)
      .post('/lore/1/move')
      .send({ parent_id: 2 })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/root/)
    // root must stay untouched
    expect(parentOf(testDbPath, 1)).toBeNull()
  })

  it('400 when moving a node to itself', async () => {
    const res = await request(app)
      .post('/lore/2/move')
      .send({ parent_id: 2 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/itself/)
    expect(parentOf(testDbPath, 2)).toBe(1)
  })

  it('400 when moving a node to its direct child (direct cycle)', async () => {
    // child-a (2) → grandchild (4) would put 2 inside 4, but 4 is already inside 2
    const res = await request(app)
      .post('/lore/2/move')
      .send({ parent_id: 4 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/descendant/)
    expect(parentOf(testDbPath, 2)).toBe(1)
  })

  it('400 when moving a node to a deeper descendant (indirect cycle)', async () => {
    // Add deeper nesting: grandchild → great-grandchild (id 5)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare('INSERT INTO lore_nodes (id, parent_id, name) VALUES (5, 4, ?)').run('great-grandchild')
    db.close()

    // Try to move child-a (2) → great-grandchild (5)
    const res = await request(app)
      .post('/lore/2/move')
      .send({ parent_id: 5 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/descendant/)
    expect(parentOf(testDbPath, 2)).toBe(1)
  })

  it('404 when the node to move does not exist', async () => {
    const res = await request(app)
      .post('/lore/999/move')
      .send({ parent_id: 3 })
    expect(res.status).toBe(404)
  })

  it('400 when the target parent does not exist', async () => {
    const res = await request(app)
      .post('/lore/3/move')
      .send({ parent_id: 999 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/target parent/)
    // node must not have moved
    expect(parentOf(testDbPath, 3)).toBe(1)
  })

  it('400 when moving an active node into a to_be_deleted parent', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(testDbPath)
    db.prepare('UPDATE lore_nodes SET to_be_deleted = 1 WHERE id = 2').run()
    db.close()

    // Try to move child-b (3, active) under child-a (2, to_be_deleted)
    const res = await request(app)
      .post('/lore/3/move')
      .send({ parent_id: 2 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/marked for deletion/)
    expect(parentOf(testDbPath, 3)).toBe(1)
  })

})

describe('POST /lore/:id/move — valid cases', () => {

  it('200: move node to a sibling (reparent within same level)', async () => {
    // Move child-b (3) under child-a (2)
    const res = await request(app)
      .post('/lore/3/move')
      .send({ parent_id: 2 })
    expect(res.status).toBe(200)
    expect(parentOf(testDbPath, 3)).toBe(2)
  })

  it('200: move grandchild to a different branch', async () => {
    // Move grandchild (4) under child-b (3)
    const res = await request(app)
      .post('/lore/4/move')
      .send({ parent_id: 3 })
    expect(res.status).toBe(200)
    expect(parentOf(testDbPath, 4)).toBe(3)
  })

  it('200: move node directly under root', async () => {
    // Move grandchild (4) to root (1)
    const res = await request(app)
      .post('/lore/4/move')
      .send({ parent_id: 1 })
    expect(res.status).toBe(200)
    expect(parentOf(testDbPath, 4)).toBe(1)
  })

})
