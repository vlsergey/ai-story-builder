import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { setCurrentDbPath } from '../../db/state.js'
import { migrateDatabase } from '../../db/migrations.js'
import { patchPlanNode, getPlanNode, deletePlanNode, startPlanNodeReview, acceptPlanNodeReview } from './plan-node-routes.js'

// ── In-memory DB setup ────────────────────────────────────────────────────────

function setupDb(dbPath: string) {
  const db = new Database(dbPath)
  migrateDatabase(db)
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
    startPlanNodeReview(2, { prompt: 'Make it better', content: 'Improved content' })

    const node = getPlanNode(2)
    expect(node.changes_status).toBe('review')
    expect(node.review_base_content).toBe('Original content')
    expect(node.last_improve_instruction).toBe('Make it better')
  })

  it('start_review on repeat does not overwrite review_base_content', () => {
    patchPlanNode(2, { content: 'Base' })
    startPlanNodeReview(2, { prompt: 'first', content: 'First improve' })
    startPlanNodeReview(2, { prompt: 'second', content: 'Second improve' })

    const node = getPlanNode(2)
    expect(node.review_base_content).toBe('Base')
    expect(node.last_improve_instruction).toBe('second')
  })

  it('accept_review clears review state', () => {
    patchPlanNode(2, { content: 'Base' })
    startPlanNodeReview(2, { prompt: 'fix it', content: 'Improved' })
    acceptPlanNodeReview(2)

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
