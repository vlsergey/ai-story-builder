import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { setCurrentDbPath } from '../db/state.js'
import { migrateDatabase } from '../db/migrations.js'
import { patchPlanNode, getPlanNode, createPlanNode, createGraphEdge } from '../plan/plan-routes.js'

// ── In-memory DB setup ────────────────────────────────────────────────────────

function setupDb(dbPath: string) {
  const db = new Database(dbPath)
  migrateDatabase(db)
  db.close()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('merge-node generation', () => {
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `merge-node-test-${Date.now()}.sqlite`)
    setupDb(dbPath)
    setCurrentDbPath(dbPath)
  })

  afterEach(() => {
    setCurrentDbPath(null)
    try { fs.unlinkSync(dbPath) } catch (_) { /* ignore */ }
  })

  it('creates a merge node with default settings', () => {
    // Create input nodes
    const input1 = createPlanNode({ title: 'Input 1', type: 'text' })
    const input2 = createPlanNode({ title: 'Input 2', type: 'text' })
    // Create merge node
    const merge = createPlanNode({ title: 'Merge', type: 'merge' })
    // Connect inputs to merge via text edges
    createGraphEdge({ from_node_id: input1.id as number, to_node_id: merge.id as number, type: 'text' })
    createGraphEdge({ from_node_id: input2.id as number, to_node_id: merge.id as number, type: 'text' })
    // Set content for inputs
    patchPlanNode(input1.id as number, { content: 'Content from input 1' })
    patchPlanNode(input2.id as number, { content: 'Content from input 2' })
    // Update merge settings (default) to trigger generation
    const res = patchPlanNode(merge.id as number, { node_type_settings: JSON.stringify({}) })
    expect(res.ok).toBe(true)
    // Retrieve merge node
    const node = getPlanNode(merge.id as number)
    expect(node.content).toBe('Content from input 1\n\nContent from input 2')
    expect(node.word_count).toBe(8) // 4 + 4 words
    expect(node.char_count).toBe(42) // 20 + 2 newlines + 20
  })

  it('includes node title when includeNodeTitle is true', () => {
    const input = createPlanNode({ title: 'Input', type: 'text' })
    const merge = createPlanNode({ title: 'My Merge', type: 'merge' })
    createGraphEdge({ from_node_id: input.id as number, to_node_id: merge.id as number, type: 'text' })
    patchPlanNode(input.id as number, { content: 'Some content' })
    const settings = { includeNodeTitle: true }
    const res = patchPlanNode(merge.id as number, { node_type_settings: JSON.stringify(settings) })
    expect(res.ok).toBe(true)
    const node = getPlanNode(merge.id as number)
    expect(node.content).toBe('# My Merge\n\nSome content')
  })

  it('includes input titles when includeInputTitles is true', () => {
    const input = createPlanNode({ title: 'Input Title', type: 'text' })
    const merge = createPlanNode({ title: 'Merge', type: 'merge' })
    createGraphEdge({ from_node_id: input.id as number, to_node_id: merge.id as number, type: 'text' })
    patchPlanNode(input.id as number, { content: 'Content here' })
    const settings = { includeInputTitles: true }
    const res = patchPlanNode(merge.id as number, { node_type_settings: JSON.stringify(settings) })
    expect(res.ok).toBe(true)
    const node = getPlanNode(merge.id as number)
    expect(node.content).toBe('## Input Title\n\nContent here')
  })

  it('fixes headers when fixHeaders is true', () => {
    const input = createPlanNode({ title: 'Input', type: 'text' })
    const merge = createPlanNode({ title: 'Merge', type: 'merge' })
    createGraphEdge({ from_node_id: input.id as number, to_node_id: merge.id as number, type: 'text' })
    // Input content with h1 and h2
    patchPlanNode(input.id as number, { content: '# Header 1\n\n## Header 2\n\nText' })
    const settings = { fixHeaders: true }
    const res = patchPlanNode(merge.id as number, { node_type_settings: JSON.stringify(settings) })
    expect(res.ok).toBe(true)
    const node = getPlanNode(merge.id as number)
    // h1 is removed entirely (not turned into plain text), h2 becomes h3
    expect(node.content).toBe('### Header 2\n\nText')
  })

  it('regenerates content when merge_settings changes', () => {
    const input = createPlanNode({ title: 'Input', type: 'text' })
    const merge = createPlanNode({ title: 'Merge', type: 'merge' })
    createGraphEdge({ from_node_id: input.id as number, to_node_id: merge.id as number, type: 'text' })
    patchPlanNode(input.id as number, { content: 'Content' })
    // First with no titles
    patchPlanNode(merge.id as number, { node_type_settings: JSON.stringify({}) })
    let node = getPlanNode(merge.id as number)
    expect(node.content).toBe('Content')
    // Change settings to include titles
    patchPlanNode(merge.id as number, { node_type_settings: JSON.stringify({ includeInputTitles: true }) })
    node = getPlanNode(merge.id as number)
    expect(node.content).toBe('## Input\n\nContent')
  })

  it('overwrites manual content when merge_settings changes', () => {
    const input = createPlanNode({ title: 'Input', type: 'text' })
    const merge = createPlanNode({ title: 'Merge', type: 'merge' })
    createGraphEdge({ from_node_id: input.id as number, to_node_id: merge.id as number, type: 'text' })
    patchPlanNode(input.id as number, { content: 'Input content' })
    // Manually set content
    patchPlanNode(merge.id as number, { content: 'Manual content' })
    // Update merge settings - should regenerate because hasContent is false
    patchPlanNode(merge.id as number, { node_type_settings: JSON.stringify({ includeNodeTitle: true }) })
    const node = getPlanNode(merge.id as number)
    expect(node.content).toBe('# Merge\n\nInput content') // regenerated with node title
  })

  it('generates content when node becomes merge type', () => {
    const input = createPlanNode({ title: 'Input', type: 'text' })
    const node = createPlanNode({ title: 'Node', type: 'text' })
    patchPlanNode(input.id as number, { content: 'Input content' })
    // Change type to merge first (no edge yet)
    const res = patchPlanNode(node.id as number, { type: 'merge' })
    expect(res.ok).toBe(true)
    // Now create merge_into edge (target is now merge, allowed)
    createGraphEdge({ from_node_id: input.id as number, to_node_id: node.id as number, type: 'text' })
    // Trigger generation by updating node_type_settings (empty object)
    patchPlanNode(node.id as number, { node_type_settings: JSON.stringify({}) })
    const updated = getPlanNode(node.id as number)
    expect(updated.content).toBe('Input content')
  })

  it('handles empty inputs gracefully', () => {
    const merge = createPlanNode({ title: 'Merge', type: 'merge' })
    const res = patchPlanNode(merge.id as number, { node_type_settings: JSON.stringify({}) })
    expect(res.ok).toBe(true)
    const node = getPlanNode(merge.id as number)
    expect(node.content).toBe('')
    expect(node.word_count).toBe(0)
  })
})