import { describe, it, expect } from 'vitest'
import { collapseLoreTree } from './lore-tree.js'
import type { LoreNodeForCollapse, CollapsedGroup } from './lore-tree.js'

function node(
  id: number,
  parent_id: number | null,
  name: string,
  content: string | null = null,
  word_count = 0,
  to_be_deleted = 0,
): LoreNodeForCollapse {
  return { id, parent_id, name, content, word_count, to_be_deleted }
}

describe('collapseLoreTree', () => {

  it('returns empty array when rows is empty', () => {
    const result = collapseLoreTree([], 10)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when only root exists (no level-2 nodes)', () => {
    const result = collapseLoreTree([node(1, null, 'Root')], 10)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('returns one group per level-2 node when no collapse needed', () => {
    const rows = [
      node(1, null,  'Root'),
      node(2, 1,     'Characters', 'Some chars', 2),
      node(3, 1,     'Locations',  'Some locs',  2),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result).toHaveLength(2)
    expect(result[0].level2NodeId).toBe(2)
    expect(result[1].level2NodeId).toBe(3)
  })

  it('returns error when level-2 count exceeds maxFiles', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'Cat1', 'c1', 1),
      node(3, 1,    'Cat2', 'c2', 1),
      node(4, 1,    'Cat3', 'c3', 1),
    ]
    const result = collapseLoreTree(rows, 2)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('Too many top-level lore categories')
      expect(result.error).toContain('3')
      expect(result.error).toContain('2')
    }
  })

  it('includes level-2 node content with # heading', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'Heroes', 'Main heroes overview', 3),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].content).toContain('# Heroes')
    expect(result[0].content).toContain('Main heroes overview')
  })

  it('merges children with deeper headings', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'World',     'World text',     2),
      node(3, 2,    'Continent', 'Continent text', 2),
      node(4, 3,    'City',      'City text',      2),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result).toHaveLength(1)
    const content = result[0].content
    expect(content).toContain('# World')
    expect(content).toContain('## Continent')
    expect(content).toContain('### City')
    expect(content).toContain('World text')
    expect(content).toContain('Continent text')
    expect(content).toContain('City text')
  })

  it('excludes to_be_deleted=1 nodes from content but includes their IDs in allNodeIds', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'Characters', 'Chars overview', 2),
      node(3, 2,    'Hero',       'Hero text',      2, 1), // deleted
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].content).not.toContain('Hero')
    expect(result[0].content).toContain('# Characters')
    expect(result[0].allNodeIds).toContain(3) // still tracked for cleanup
  })

  it('excludes empty nodes (word_count=0) from content', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'Category', 'Some content', 2),
      node(3, 2,    'Empty',    '',             0),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].content).not.toContain('Empty')
    expect(result[0].allNodeIds).toContain(3)
  })

  it('sets hasContent=false when all nodes in group are empty or deleted', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'EmptyGroup', '', 0),
      node(3, 2,    'Child',      '', 0),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].hasContent).toBe(false)
    expect(result[0].content).toBe('')
  })

  it('sets hasContent=false when level-2 node itself is to_be_deleted', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'DeletedGroup', 'text', 1, 1), // deleted
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].hasContent).toBe(false)
  })

  it('allNodeIds includes all descendants regardless of deletion status', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'Group', 'g', 1),
      node(3, 2,    'Child', 'c', 1),
      node(4, 3,    'Grand', 'g', 1, 1), // deleted
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].allNodeIds).toContain(2)
    expect(result[0].allNodeIds).toContain(3)
    expect(result[0].allNodeIds).toContain(4)
  })

  it('separates multiple nodes with --- dividers', () => {
    const rows = [
      node(1, null, 'Root'),
      node(2, 1,    'Group', 'group text', 2),
      node(3, 2,    'Child', 'child text', 2),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].content).toContain('---')
  })

  it('handles exactly maxFiles level-2 nodes without error', () => {
    const rows = [node(1, null, 'Root')]
    for (let i = 2; i <= 10; i++) {
      rows.push(node(i, 1, `Cat${i}`, `content ${i}`, 1))
    }
    const result = collapseLoreTree(rows, 10)
    expect(Array.isArray(result)).toBe(true)
    expect((result as CollapsedGroup[]).length).toBe(9)
  })
})
