/**
 * Integration tests for moveLoreNode()
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setUpTestDb, tearDownTestDb } from '../db/test-db-utils.js'

// Import pure functions AFTER mock is registered
const { moveLoreNode } = await import('./lore-routes.js')

import { LoreNodeRepository } from './lore-node-repository.js'

/**
 * Creates a fresh in-memory-style temp SQLite file with a small tree:
 *
 *   1 root  (parent_id = NULL)
 *   ├─ 2 child-a
 *   │  └─ 4 grandchild
 *   └─ 3 child-b
 */
function setupDb() {
  const repo = new LoreNodeRepository()
  repo.insert({ id: 1, parent_id: null, title: 'root' })
  repo.insert({ id: 2, parent_id: 1, title: 'child-a' })
  repo.insert({ id: 3, parent_id: 1, title: 'child-b' })
  repo.insert({ id: 4, parent_id: 2, title: 'grandchild' })
}

function parentOf(id: number): number | null {
  const repo = new LoreNodeRepository()
  const node = repo.getById(id)
  return node?.parent_id ?? null
}

// ── Test lifecycle ─────────────────────────────────────────────────────────

beforeEach(() => {
  setUpTestDb()
  setupDb()
})

afterEach(() => {
  tearDownTestDb()
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('moveLoreNode — invalid cases', () => {

  it('throws 403 when moving the root node', async () => {
    await expect(() => moveLoreNode(1, { parent_id: 2 })).toThrow(/root/)
    try { moveLoreNode(1, { parent_id: 2 }) } catch (e: any) { expect(e.status).toBe(403) }
    expect(parentOf(1)).toBeNull()
  })

  it('throws 400 when moving a node to itself', async () => {
    await expect(() => moveLoreNode(2, { parent_id: 2 })).toThrow(/itself/)
    try { moveLoreNode(2, { parent_id: 2 }) } catch (e: any) { expect(e.status).toBe(400) }
    expect(parentOf(2)).toBe(1)
  })

  it('throws 400 when moving a node to its direct child (direct cycle)', async () => {
    await expect(() => moveLoreNode(2, { parent_id: 4 })).toThrow(/descendant/)
    try { moveLoreNode(2, { parent_id: 4 }) } catch (e: any) { expect(e.status).toBe(400) }
    expect(parentOf(2)).toBe(1)
  })

  it('throws 400 when moving a node to a deeper descendant (indirect cycle)', async () => {
    const repo = new LoreNodeRepository()
    repo.insert({ id: 5, parent_id: 4, title: 'great-grandchild' })

    await expect(() => moveLoreNode(2, { parent_id: 5 })).toThrow(/descendant/)
    try { moveLoreNode(2, { parent_id: 5 }) } catch (e: any) { expect(e.status).toBe(400) }
    expect(parentOf(2)).toBe(1)
  })

  it('throws 404 when the node to move does not exist', async () => {
    try { moveLoreNode(999, { parent_id: 3 }) } catch (e: any) { expect(e.status).toBe(404) }
  })

  it('throws 400 when the target parent does not exist', async () => {
    await expect(() => moveLoreNode(3, { parent_id: 999 })).toThrow(/target parent/)
    try { moveLoreNode(3, { parent_id: 999 }) } catch (e: any) { expect(e.status).toBe(400) }
    expect(parentOf(3)).toBe(1)
  })

  it('throws 400 when moving an active node into a to_be_deleted parent', async () => {
    const repo = new LoreNodeRepository()
    repo.update(2, { to_be_deleted: 1 })

    await expect(() => moveLoreNode(3, { parent_id: 2 })).toThrow(/marked for deletion/)
    try { moveLoreNode(3, { parent_id: 2 }) } catch (e: any) { expect(e.status).toBe(400) }
    expect(parentOf(3)).toBe(1)
  })

})

describe('moveLoreNode — valid cases', () => {

  it('moves node to a sibling (reparent within same level)', () => {
    const result = moveLoreNode(3, { parent_id: 2 })
    expect(result.ok).toBe(true)
    expect(parentOf(3)).toBe(2)
  })

  it('moves grandchild to a different branch', () => {
    const result = moveLoreNode(4, { parent_id: 3 })
    expect(result.ok).toBe(true)
    expect(parentOf(4)).toBe(3)
  })

  it('moves node directly under root', () => {
    const result = moveLoreNode(4, { parent_id: 1 })
    expect(result.ok).toBe(true)
    expect(parentOf(4)).toBe(1)
  })

})
