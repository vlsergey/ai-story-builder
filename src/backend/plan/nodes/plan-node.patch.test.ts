import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { setCurrentDbPath } from '../../db/state.js'
import { patchPlanNode, getPlanNode, deletePlanNode } from '../plan-routes.js'

// ── In-memory DB setup ────────────────────────────────────────────────────────

function setupDb(dbPath: string) {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE plan_nodes (
      id                   INTEGER PRIMARY KEY,
      parent_id            INTEGER NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
      title                TEXT NOT NULL,
      content              TEXT,
      position             INTEGER DEFAULT 0,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      type                 TEXT NOT NULL DEFAULT 'text',
      x                    REAL DEFAULT 0,
      y                    REAL DEFAULT 0,
      user_prompt          TEXT,
      system_prompt        TEXT,
      summary              TEXT,
      auto_summary         INTEGER DEFAULT 0,
      ai_sync_info         TEXT,
      word_count           INTEGER NOT NULL DEFAULT 0,
      char_count           INTEGER NOT NULL DEFAULT 0,
      byte_count           INTEGER NOT NULL DEFAULT 0,
      changes_status       TEXT NULL,
      status               TEXT NOT NULL DEFAULT 'EMPTY',
      review_base_content  TEXT NULL,
      last_improve_instruction TEXT NULL,
      node_type_settings   TEXT NULL
    );
    CREATE TABLE plan_edges (
      id           INTEGER PRIMARY KEY,
      from_node_id INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
      to_node_id   INTEGER NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
      type         TEXT NOT NULL DEFAULT 'instruction',
      position     INTEGER DEFAULT 0,
      label        TEXT,
      template     TEXT
    );
  `)
  // Root + child
  db.prepare("INSERT INTO plan_nodes (id, parent_id, title, position) VALUES (1, NULL, 'Root', 0)").run()
  db.prepare("INSERT INTO plan_nodes (id, parent_id, title, position) VALUES (2, 1, 'Child', 0)").run()
  db.close()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('patchPlanNode', () => {
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `plans-test-${Date.now()}.sqlite`)
    setupDb(dbPath)
    setCurrentDbPath(dbPath)
  })

  afterEach(() => {
    setCurrentDbPath(null)
    try { fs.unlinkSync(dbPath) } catch (_) { /* ignore */ }
  })

  it('updates title', () => {
    const res = patchPlanNode(2, { title: 'Updated Title' })
    expect(res.ok).toBe(true)

    const node = getPlanNode(2)
    expect(node.title).toBe('Updated Title')
  })

  it('updates content and returns counts', () => {
    const res = patchPlanNode(2, { content: 'Hello world' })
    expect(res.ok).toBe(true)
    expect(res.word_count).toBe(2)
    expect(res.char_count).toBe(11)
  })

  it('start_review sets changes_status and captures review_base_content', () => {
    patchPlanNode(2, { content: 'Original content' })
    patchPlanNode(2, { content: 'Improved content', start_review: true, prompt: 'Make it better' })

    const node = getPlanNode(2)
    expect(node.changes_status).toBe('review')
    expect(node.review_base_content).toBe('Original content')
    expect(node.last_improve_instruction).toBe('Make it better')
  })

  it('start_review on repeat does not overwrite review_base_content', () => {
    patchPlanNode(2, { content: 'Base' })
    patchPlanNode(2, { content: 'First improve', start_review: true, prompt: 'first' })
    patchPlanNode(2, { content: 'Second improve', start_review: true, prompt: 'second' })

    const node = getPlanNode(2)
    expect(node.review_base_content).toBe('Base')
    expect(node.last_improve_instruction).toBe('second')
  })

  it('accept_review clears review state', () => {
    patchPlanNode(2, { content: 'Base' })
    patchPlanNode(2, { content: 'Improved', start_review: true, prompt: 'fix it' })
    patchPlanNode(2, { content: 'Improved', accept_review: true })

    const node = getPlanNode(2)
    expect(node.changes_status).toBeNull()
    expect(node.review_base_content).toBeNull()
    expect(node.last_improve_instruction).toBeNull()
  })

  it('throws 400 when no fields provided', () => {
    expect(() => patchPlanNode(2, {})).toThrow()
    try { patchPlanNode(2, {}) } catch (e: any) { expect(e.status).toBe(400) }
  })
})

describe('deletePlanNode', () => {
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `plans-test-${Date.now()}.sqlite`)
    setupDb(dbPath)
    setCurrentDbPath(dbPath)
  })

  afterEach(() => {
    setCurrentDbPath(null)
    try { fs.unlinkSync(dbPath) } catch (_) { /* ignore */ }
  })

  it('deletes a child node', () => {
    const res = deletePlanNode(2)
    expect(res.ok).toBe(true)

    expect(() => getPlanNode(2)).toThrow()
    try { getPlanNode(2) } catch (e: any) { expect(e.status).toBe(404) }
  })

  it('deletes root node (and cascades to child)', () => {
    const res = deletePlanNode(1)
    expect(res.ok).toBe(true)

    // Root should be gone
    expect(() => getPlanNode(1)).toThrow()
    try { getPlanNode(1) } catch (e: any) { expect(e.status).toBe(404) }
    // Child should also be deleted due to cascade
    expect(() => getPlanNode(2)).toThrow()
    try { getPlanNode(2) } catch (e: any) { expect(e.status).toBe(404) }
  })
})
