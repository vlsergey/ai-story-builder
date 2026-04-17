import { describe, expect, it } from "vitest"
import type { CollapsedGroup, LoreNodeForCollapse } from "./lore-tree.js"
import { collapseLoreTree } from "./lore-tree.js"

function node(
  id: number,
  parent_id: number | null,
  name: string,
  content: string | null = null,
  word_count = 0,
  to_be_deleted = 0,
): LoreNodeForCollapse {
  return { id, parent_id, title: name, content, word_count, to_be_deleted }
}

describe("collapseLoreTree", () => {
  it("returns empty array when rows is empty", () => {
    const result = collapseLoreTree([], 10)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it("returns empty array when only root exists (no level-2 nodes)", () => {
    const result = collapseLoreTree([node(1, null, "Root")], 10)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it("returns one group per level-2 node when no collapse needed", () => {
    const rows = [
      node(1, null, "Root"),
      node(2, 1, "Characters", "Some chars", 2),
      node(3, 1, "Locations", "Some locs", 2),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result).toHaveLength(2)
    expect(result[0].level2NodeId).toBe(2)
    expect(result[1].level2NodeId).toBe(3)
  })

  it("returns error when level-2 count exceeds maxFiles", () => {
    const rows = [
      node(1, null, "Root"),
      node(2, 1, "Cat1", "c1", 1),
      node(3, 1, "Cat2", "c2", 1),
      node(4, 1, "Cat3", "c3", 1),
    ]
    const result = collapseLoreTree(rows, 2)
    expect("error" in result).toBe(true)
    if ("error" in result) {
      expect(result.error).toContain("Too many top-level lore categories")
      expect(result.error).toContain("3")
      expect(result.error).toContain("2")
    }
  })

  it("includes level-2 node content with # heading (name only, no breadcrumb)", () => {
    const rows = [node(1, null, "Root"), node(2, 1, "Heroes", "Main heroes overview", 3)]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].content).toContain("# Heroes")
    expect(result[0].content).toContain("Main heroes overview")
  })

  it("merges children with deeper headings including ancestor breadcrumbs", () => {
    const rows = [
      node(1, null, "Root"),
      node(2, 1, "World", "World text", 2),
      node(3, 2, "Continent", "Continent text", 2),
      node(4, 3, "City", "City text", 2),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result).toHaveLength(1)
    const content = result[0].content
    // depth-1: name only
    expect(content).toContain("# World")
    // depth-2: Level2 / Name
    expect(content).toContain("## World / Continent")
    // depth-3: Level2 / Level3 / Name
    expect(content).toContain("### World / Continent / City")
    expect(content).toContain("World text")
    expect(content).toContain("Continent text")
    expect(content).toContain("City text")
  })

  it("depth-2 heading does not appear without breadcrumb (old format)", () => {
    // Regression: depth-2 headings must NOT be bare '## Continent' but '## World / Continent'
    const rows = [node(1, null, "Root"), node(2, 1, "World", "w", 1), node(3, 2, "Continent", "c", 1)]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    const content = result[0].content
    expect(content).not.toMatch(/^## Continent$/m)
    expect(content).toContain("## World / Continent")
  })

  it("excludes to_be_deleted=1 nodes from content but includes their IDs in allNodeIds", () => {
    const rows = [
      node(1, null, "Root"),
      node(2, 1, "Characters", "Chars overview", 2),
      node(3, 2, "Hero", "Hero text", 2, 1), // deleted
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].content).not.toContain("Hero")
    expect(result[0].content).toContain("# Characters")
    expect(result[0].allNodeIds).toContain(3) // still tracked for cleanup
  })

  it("excludes empty nodes (word_count=0) from content", () => {
    const rows = [node(1, null, "Root"), node(2, 1, "Category", "Some content", 2), node(3, 2, "Empty", "", 0)]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].content).not.toContain("Empty")
    expect(result[0].allNodeIds).toContain(3)
  })

  it("sets hasContent=false when all nodes in group are empty or deleted", () => {
    const rows = [node(1, null, "Root"), node(2, 1, "EmptyGroup", "", 0), node(3, 2, "Child", "", 0)]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].hasContent).toBe(false)
    expect(result[0].content).toBe("")
  })

  it("sets hasContent=false when level-2 node itself is to_be_deleted", () => {
    const rows = [
      node(1, null, "Root"),
      node(2, 1, "DeletedGroup", "text", 1, 1), // deleted
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].hasContent).toBe(false)
  })

  it("allNodeIds includes all descendants regardless of deletion status", () => {
    const rows = [
      node(1, null, "Root"),
      node(2, 1, "Group", "g", 1),
      node(3, 2, "Child", "c", 1),
      node(4, 3, "Grand", "g", 1, 1), // deleted
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].allNodeIds).toContain(2)
    expect(result[0].allNodeIds).toContain(3)
    expect(result[0].allNodeIds).toContain(4)
  })

  it("separates multiple nodes with --- dividers", () => {
    const rows = [node(1, null, "Root"), node(2, 1, "Group", "group text", 2), node(3, 2, "Child", "child text", 2)]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result[0].content).toContain("---")
  })

  it("handles exactly maxFiles level-2 nodes without error", () => {
    const rows = [node(1, null, "Root")]
    for (let i = 2; i <= 10; i++) {
      rows.push(node(i, 1, `Cat${i}`, `content ${i}`, 1))
    }
    const result = collapseLoreTree(rows, 10)
    expect(Array.isArray(result)).toBe(true)
    expect((result as CollapsedGroup[]).length).toBe(9)
  })

  // ── Root content ────────────────────────────────────────────────────────────

  it("prepends a root group with # heading when root has non-empty content", () => {
    const rows = [node(1, null, "My Story", "Project overview text", 3), node(2, 1, "Characters", "Char content", 2)]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    // First group is the root
    expect(result[0].level2NodeId).toBe(1)
    expect(result[0].content).toBe("# My Story\n\nProject overview text")
    expect(result[0].hasContent).toBe(true)
    expect(result[0].allNodeIds).toEqual([1])
    // Second group is the l2 node
    expect(result[1].level2NodeId).toBe(2)
    expect(result).toHaveLength(2)
  })

  it("does not add a root group when root has no content", () => {
    const rows = [node(1, null, "Root"), node(2, 1, "Characters", "Char content", 2)]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result).toHaveLength(1)
    expect(result[0].level2NodeId).toBe(2)
  })

  it("does not add a root group when root is to_be_deleted", () => {
    const rows = [
      node(1, null, "Root", "Has content", 2, 1), // deleted
      node(2, 1, "Characters", "Char content", 2),
    ]
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(result).toHaveLength(1)
    expect(result[0].level2NodeId).toBe(2)
  })

  it("root group counts against maxFiles limit", () => {
    // 9 level-2 nodes + 1 root group = 10 total; maxFiles=10 should be fine
    const rows = [node(1, null, "Root", "root content", 1)]
    for (let i = 2; i <= 10; i++) {
      rows.push(node(i, 1, `Cat${i}`, `content ${i}`, 1))
    }
    const result = collapseLoreTree(rows, 10) as CollapsedGroup[]
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(10) // 1 root + 9 l2

    // 10 level-2 nodes + root → 11 total, exceeds maxFiles=10
    rows.push(node(11, 1, "Cat11", "content 11", 1))
    const result2 = collapseLoreTree(rows, 10)
    expect("error" in result2).toBe(true)
  })
})
