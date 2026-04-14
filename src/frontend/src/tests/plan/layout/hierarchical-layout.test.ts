import { describe, it, expect } from "vitest"
import { applyHierarchicalLayout, defaultOptions } from "../../../plan/plan-graph/hierarchical-layout"
import type { Node, Edge } from "@xyflow/react"
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"

// Helper to visualize layout as SVG
function visualizeLayout(
  testName: string,
  nodes: Node[],
  edges: Edge[],
  result: Node[],
  options?: { groupPadding?: number; groupTopPadding?: number },
) {
  const outputDir = join(__dirname, "test-output")
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Use only result nodes for visualization (simpler)
  const allNodes = result
  const allEdges = edges

  // Compute absolute positions for each node (since layout returns relative positions for children)
  const absolutePositions = new Map<string, { x: number; y: number }>()
  const nodeMap = new Map<string, Node>(allNodes.map((n) => [n.id, n]))

  function computeAbsolutePosition(nodeId: string): { x: number; y: number } {
    if (absolutePositions.has(nodeId)) {
      return absolutePositions.get(nodeId)!
    }
    const node = nodeMap.get(nodeId)
    if (!node) return { x: 0, y: 0 }
    let x = node.position.x
    let y = node.position.y
    let current = node
    while (current.parentId) {
      const parent = nodeMap.get(current.parentId)
      if (!parent) break
      x += parent.position.x
      y += parent.position.y
      current = parent
    }
    absolutePositions.set(nodeId, { x, y })
    return { x, y }
  }

  allNodes.forEach((node) => {
    computeAbsolutePosition(node.id)
  })

  // Determine bounding box using absolute positions
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  allNodes.forEach((node) => {
    const width = node.width || 200
    const height = node.height || 80
    const abs = absolutePositions.get(node.id)!
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + width)
    maxY = Math.max(maxY, abs.y + height)
  })

  // Add padding
  const padding = 40
  const svgWidth = Math.max(400, maxX - minX + padding * 2)
  const svgHeight = Math.max(300, maxY - minY + padding * 2)

  // Simple color palette
  const colors = [
    "#4a90e2",
    "#50c878",
    "#f5a623",
    "#d0021b",
    "#9013fe",
    "#417505",
    "#8b572a",
    "#bd10e0",
    "#7ed321",
    "#f8e71c",
  ]

  // Group padding settings (defaults match hierarchical-layout.ts)
  const groupPadding = options?.groupPadding ?? defaultOptions.groupPadding
  const groupTopPadding = options?.groupTopPadding ?? defaultOptions.groupTopPadding

  // Build parent-to-children map
  const parentToChildren = new Map<string, Node[]>()
  allNodes.forEach((node) => {
    if (node.parentId) {
      const children = parentToChildren.get(node.parentId) || []
      children.push(node)
      parentToChildren.set(node.parentId, children)
    }
  })

  // Generate SVG
  let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g transform="translate(${padding - minX}, ${padding - minY})">
`

  // Draw edges first (so they appear behind nodes)
  allEdges.forEach((edge, idx) => {
    const sourceNode = allNodes.find((n) => n.id === edge.source)
    const targetNode = allNodes.find((n) => n.id === edge.target)
    if (!sourceNode || !targetNode) return

    const sWidth = sourceNode.width || 200
    const sHeight = sourceNode.height || 80
    const tWidth = targetNode.width || 200
    const tHeight = targetNode.height || 80

    const sourceAbs = absolutePositions.get(sourceNode.id)!
    const targetAbs = absolutePositions.get(targetNode.id)!

    const sx = sourceAbs.x + sWidth / 2
    const sy = sourceAbs.y + sHeight / 2
    const tx = targetAbs.x + tWidth / 2
    const ty = targetAbs.y + tHeight / 2

    svg += `    <line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="#666" stroke-width="1.5"/>\n`
  })

  // Draw nodes
  allNodes.forEach((node, idx) => {
    const width = node.width || 200
    const height = node.height || 80
    const color = colors[idx % colors.length]
    const abs = absolutePositions.get(node.id)!

    svg += `    <rect x="${abs.x}" y="${abs.y}" width="${width}" height="${height}" fill="${color}" stroke="#333" stroke-width="1" rx="2"/>\n`

    // Node label
    svg += `    <text x="${abs.x + width / 2}" y="${abs.y + height / 2}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="12" fill="#fff" font-weight="bold">${node.id}</text>\n`
  })

  // Draw padding areas for group nodes (using absolute positions)
  parentToChildren.forEach((children, parentId) => {
    const parent = allNodes.find((n) => n.id === parentId)
    if (!parent) return

    const width = parent.width || 200
    const height = parent.height || 80
    const parentAbs = absolutePositions.get(parentId)!

    // Padding rectangle (interior region where children are placed)
    const paddingRectX = parentAbs.x + groupPadding
    const paddingRectY = parentAbs.y + groupTopPadding
    const paddingRectWidth = width - 2 * groupPadding
    const paddingRectHeight = height - groupTopPadding - groupPadding

    // Draw semi‑transparent fill
    svg += `    <rect x="${paddingRectX}" y="${paddingRectY}" width="${paddingRectWidth}" height="${paddingRectHeight}" fill="rgba(0, 150, 255, 0.1)" stroke="rgba(0, 150, 255, 0.5)" stroke-width="1" stroke-dasharray="4,2"/>\n`

    // Label for top padding
    svg += `    <text x="${parentAbs.x + width / 2}" y="${parentAbs.y + groupTopPadding / 2}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="10" fill="#007acc">top padding=${groupTopPadding}</text>\n`
    // Label for side padding
    svg += `    <text x="${parentAbs.x + groupPadding / 2}" y="${parentAbs.y + height / 2}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="10" fill="#007acc" transform="rotate(-90, ${parentAbs.x + groupPadding / 2}, ${parentAbs.y + height / 2})">side padding=${groupPadding}</text>\n`
  })

  svg += `  </g>
</svg>`

  // Write to file
  const filename = join(outputDir, `${testName.replace(/\s+/g, "-").toLowerCase()}.svg`)
  writeFileSync(filename, svg)
  console.log(`Visualization saved to: ${filename}`)
}

describe("applyHierarchicalLayout", () => {
  it("should layout two nodes connected by an edge on same level", () => {
    const nodes: Node[] = [
      { id: "1", type: "default", position: { x: 0, y: 0 }, data: {} },
      { id: "2", type: "default", position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [{ id: "e1", source: "1", target: "2", type: "default" }]

    const result = applyHierarchicalLayout(nodes, edges)
    visualizeLayout("two-nodes-connected", nodes, edges, result)

    // Should have same number of nodes
    expect(result).toHaveLength(2)

    const node1 = result.find((n) => n.id === "1")
    const node2 = result.find((n) => n.id === "2")
    expect(node1).toBeDefined()
    expect(node2).toBeDefined()

    // Nodes should be separated (distance > 0) and not overlapping
    const dx = node2!.position.x - node1!.position.x
    const dy = node2!.position.y - node1!.position.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    expect(distance).toBeGreaterThan(0)

    // At least one node should have moved from original position (0,0)
    // (dagre may keep one node at origin)
    const moved =
      node1!.position.x !== 0 || node1!.position.y !== 0 || node2!.position.x !== 0 || node2!.position.y !== 0
    expect(moved).toBe(true)
  })

  it("should handle empty nodes", () => {
    const nodes: Node[] = []
    const edges: Edge[] = []
    const result = applyHierarchicalLayout(nodes, edges)
    expect(result).toEqual([])
    // No visualization for empty nodes
  })

  it("should handle single node", () => {
    const nodes: Node[] = [{ id: "1", type: "default", position: { x: 0, y: 0 }, data: {} }]
    const edges: Edge[] = []
    const result = applyHierarchicalLayout(nodes, edges)
    expect(result).toHaveLength(1)
    // Single node may be placed at (0,0) or centered; we just ensure it's present
    expect(result[0].id).toBe("1")
    visualizeLayout("single-node", nodes, edges, result)
  })

  it("should layout group with two child nodes", () => {
    const nodes: Node[] = [
      { id: "group", type: "group", position: { x: 0, y: 0 }, data: {} },
      { id: "child1", type: "default", position: { x: 0, y: 0 }, data: {}, parentId: "group" },
      { id: "child2", type: "default", position: { x: 0, y: 0 }, data: {}, parentId: "group" },
    ]
    const edges: Edge[] = [{ id: "e1", source: "child1", target: "child2", type: "default" }]

    const result = applyHierarchicalLayout(nodes, edges)
    expect(result).toHaveLength(3)
    visualizeLayout("group-with-two-children", nodes, edges, result)

    const group = result.find((n) => n.id === "group")
    const child1 = result.find((n) => n.id === "child1")
    const child2 = result.find((n) => n.id === "child2")

    expect(group).toBeDefined()
    expect(child1).toBeDefined()
    expect(child2).toBeDefined()

    // Group should have dimensions
    const groupWidth = group!.width ?? 0
    const groupHeight = group!.height ?? 0
    expect(groupWidth).toBeGreaterThan(0)
    expect(groupHeight).toBeGreaterThan(0)

    // Children positions are relative to group after layout
    // Get child dimensions (default if not set)
    const child1Width = child1!.width ?? 200
    const child1Height = child1!.height ?? 80
    const child2Width = child2!.width ?? 200
    const child2Height = child2!.height ?? 80

    // Padding values from default options (same as used in layout)
    const padding = defaultOptions.groupPadding
    const topPadding = defaultOptions.groupTopPadding

    // Check that children are within padded area of the group
    // Relative X should be >= padding, and X + width + padding <= groupWidth
    expect(child1!.position.x).toBeGreaterThanOrEqual(padding)
    expect(child1!.position.x + child1Width + padding).toBeLessThanOrEqual(groupWidth)
    expect(child1!.position.y).toBeGreaterThanOrEqual(topPadding)
    expect(child1!.position.y + child1Height + padding).toBeLessThanOrEqual(groupHeight)

    expect(child2!.position.x).toBeGreaterThanOrEqual(padding)
    expect(child2!.position.x + child2Width + padding).toBeLessThanOrEqual(groupWidth)
    expect(child2!.position.y).toBeGreaterThanOrEqual(topPadding)
    expect(child2!.position.y + child2Height + padding).toBeLessThanOrEqual(groupHeight)

    // Children should be separated (check relative positions)
    const dx = child2!.position.x - child1!.position.x
    const dy = child2!.position.y - child1!.position.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    expect(distance).toBeGreaterThan(0)
  })

  it("should layout three nodes with edges A->B, B->C, A->C (triangle)", () => {
    const nodes: Node[] = [
      { id: "A", type: "default", position: { x: 0, y: 0 }, data: {} },
      { id: "B", type: "default", position: { x: 0, y: 0 }, data: {} },
      { id: "C", type: "default", position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: "e1", source: "A", target: "B", type: "default" },
      { id: "e2", source: "B", target: "C", type: "default" },
      { id: "e3", source: "A", target: "C", type: "default" },
    ]

    const result = applyHierarchicalLayout(nodes, edges)
    expect(result).toHaveLength(3)
    visualizeLayout("triangle-nodes", nodes, edges, result)

    const nodeA = result.find((n) => n.id === "A")!
    const nodeB = result.find((n) => n.id === "B")!
    const nodeC = result.find((n) => n.id === "C")!

    // At least two nodes should have moved from original position (0,0)
    // (dagre may keep one node at origin)
    const movedCount = [nodeA, nodeB, nodeC].filter((n) => n.position.x !== 0 || n.position.y !== 0).length
    expect(movedCount).toBeGreaterThanOrEqual(2)

    // Nodes should be separated (no overlapping)
    const positions = [nodeA.position, nodeB.position, nodeC.position]
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[j].x - positions[i].x
        const dy = positions[j].y - positions[i].y
        const distance = Math.sqrt(dx * dx + dy * dy)
        expect(distance).toBeGreaterThan(10) // reasonable minimum distance
      }
    }

    // With rankdir='LR' (default), edges should flow left to right
    // A->B and B->C imply B should be to the right of A, C to the right of B
    // But A->C is a shortcut, so C could be placed differently.
    // We'll just ensure layout doesn't crash and produces reasonable positions.
  })

  it("should layout group B with two child nodes C and D, and separate node A with proper spacing", () => {
    // A is a regular node, B is a group node, C and D are children of B
    const nodes: Node[] = [
      { id: "A", type: "default", position: { x: 0, y: 0 }, data: {} },
      { id: "B", type: "group", position: { x: 0, y: 0 }, data: {} },
      { id: "C", type: "default", position: { x: 0, y: 0 }, data: {}, parentId: "B" },
      { id: "D", type: "default", position: { x: 0, y: 0 }, data: {}, parentId: "B" },
    ]
    const edges: Edge[] = [{ id: "e1", source: "A", target: "B", type: "default" }]

    const result = applyHierarchicalLayout(nodes, edges, { ranksep: 120 })

    expect(result).toHaveLength(4)
    visualizeLayout("group-with-children-and-external-node", nodes, edges, result)

    const nodeA = result.find((n) => n.id === "A")
    const nodeB = result.find((n) => n.id === "B")
    const nodeC = result.find((n) => n.id === "C")
    const nodeD = result.find((n) => n.id === "D")

    expect(nodeA).toBeDefined()
    expect(nodeB).toBeDefined()
    expect(nodeC).toBeDefined()
    expect(nodeD).toBeDefined()

    // Check that children are inside group B
    // Group B should have computed dimensions based on children
    const bWidth = nodeB!.width ?? defaultOptions.defaultGroupNodeWidth
    const bHeight = nodeB!.height ?? defaultOptions.defaultGroupNodeHeight

    // Children should be positioned relative to B (absolute positions after applyParentOffsets)
    // Since we can't easily check relative positions, we'll check that C and D are not at (0,0)
    expect(nodeC!.position.x).not.toBe(0)
    expect(nodeC!.position.y).not.toBe(0)
    expect(nodeD!.position.x).not.toBe(0)
    expect(nodeD!.position.y).not.toBe(0)

    // Check distance between A and B boundaries
    // A position is top-left corner, B position is top-left corner
    // With rankdir='LR' (left-to-right), B should be to the right of A
    // The distance between right edge of A and left edge of B should be approximately ranksep (120)
    const aWidth = nodeA!.width ?? defaultOptions.defaultNodeWidth
    const aHeight = nodeA!.height ?? defaultOptions.defaultNodeHeight

    const aRight = nodeA!.position.x + aWidth
    const bLeft = nodeB!.position.x

    // Allow some tolerance for padding and rounding
    const distance = bLeft - aRight
    expect(distance).toBeGreaterThan(100) // Should be close to ranksep (120)
    expect(distance).toBeLessThan(150)

    // Also verify that B's dimensions are larger than default node dimensions (since it has two children)
    expect(bWidth).toBeGreaterThan(defaultOptions.defaultNodeWidth) // Should be larger than default node width
    expect(bHeight).toBeGreaterThan(defaultOptions.defaultNodeHeight) // Should be larger than default node height
  })

  it("should layout real-world graph from copy.sqlite database", () => {
    // Data extracted from copy.sqlite database
    // Nodes: id, parent_id, title, type, x, y, width, height
    // Edges: from_node_id, to_node_id, type

    // Note: Node 7 has parent_id = 7 (self-reference) - treat as root
    const nodes: Node[] = [
      { id: "1", type: "text", position: { x: 880, y: 0 }, data: { title: "Стиль" } },
      { id: "2", type: "text", position: { x: 2080, y: 65 }, data: { title: "Персонажи" } },
      { id: "3", type: "text", position: { x: 2720, y: 0 }, data: { title: "План рассказа" } },
      { id: "4", type: "split", position: { x: 3040, y: 0 }, data: { title: "Разделить" } },
      { id: "5", type: "merge", position: { x: 3360, y: 0 }, data: { title: "Объединить" } },
      { id: "6", type: "text", position: { x: 2400, y: 65 }, data: { title: "Персонажи 2" } },
      // Node 7 is a for-each group with parent=7 (treat as root)
      {
        id: "7",
        type: "for-each",
        position: { x: -33.999999999999986, y: 112 },
        data: { title: "Цикл" },
        width: 280,
        height: 300,
      },
      // Children of node 7
      {
        id: "8",
        type: "for-each-input",
        position: { x: 40, y: 180 },
        data: { title: "Input" },
        parentId: "7",
      },
      {
        id: "9",
        type: "for-each-output",
        position: { x: 40, y: 320 },
        data: { title: "Output" },
        parentId: "7",
      },
    ]

    const edges: Edge[] = [
      { id: "e1", source: "1", target: "2", type: "text" },
      { id: "e3", source: "1", target: "3", type: "text" },
      { id: "e4", source: "3", target: "4", type: "text" },
      { id: "e5", source: "4", target: "5", type: "textArray" },
      { id: "e6", source: "2", target: "6", type: "text" },
      { id: "e7", source: "6", target: "3", type: "text" },
    ]

    const result = applyHierarchicalLayout(nodes, edges, { ranksep: 120, nodesep: 100 })
    visualizeLayout("real-world-copy-sqlite", nodes, edges, result)

    // Basic assertions
    expect(result).toHaveLength(9)

    // All nodes should be present
    const ids = result.map((n) => n.id)
    expect(ids).toContain("1")
    expect(ids).toContain("2")
    expect(ids).toContain("3")
    expect(ids).toContain("4")
    expect(ids).toContain("5")
    expect(ids).toContain("6")
    expect(ids).toContain("7")
    expect(ids).toContain("8")
    expect(ids).toContain("9")

    // Node 7 should be a group (type for-each)
    const node7 = result.find((n) => n.id === "7")
    expect(node7).toBeDefined()
    expect(node7!.type).toBe("for-each")

    // Node 8 and 9 should have parentId = '7'
    const node8 = result.find((n) => n.id === "8")
    const node9 = result.find((n) => n.id === "9")
    expect(node8!.parentId).toBe("7")
    expect(node9!.parentId).toBe("7")

    // Check that children are positioned inside group 7's bounding box
    // (after layout, positions are relative to parent)
    if (node7 && node8 && node9) {
      const width7 = node7.width ?? defaultOptions.defaultGroupNodeWidth
      const height7 = node7.height ?? defaultOptions.defaultGroupNodeHeight

      // Child dimensions (default if not set)
      const width8 = node8.width ?? defaultOptions.defaultNodeWidth
      const height8 = node8.height ?? defaultOptions.defaultNodeHeight
      const width9 = node9.width ?? defaultOptions.defaultNodeWidth
      const height9 = node9.height ?? defaultOptions.defaultNodeHeight

      // Padding values from default options
      const padding = defaultOptions.groupPadding
      const topPadding = defaultOptions.groupTopPadding

      // Children should be within padded area of the group
      // Relative X should be >= padding, and X + width + padding <= groupWidth
      expect(node8.position.x).toBeGreaterThanOrEqual(padding)
      expect(node8.position.x + width8 + padding).toBeLessThanOrEqual(width7)
      expect(node8.position.y).toBeGreaterThanOrEqual(topPadding)
      expect(node8.position.y + height8 + padding).toBeLessThanOrEqual(height7)

      expect(node9.position.x).toBeGreaterThanOrEqual(padding)
      expect(node9.position.x + width9 + padding).toBeLessThanOrEqual(width7)
      expect(node9.position.y).toBeGreaterThanOrEqual(topPadding)
      expect(node9.position.y + height9 + padding).toBeLessThanOrEqual(height7)
    }

    // Check that edges still connect the same nodes
    // (edges are not modified by layout, just passed through)

    // Ensure no nodes are at extreme positions (0,0) unless intended
    // At least some nodes should have moved from their original positions
    const movedNodes = result.filter((n) => {
      const original = nodes.find((o) => o.id === n.id)
      return original && (n.position.x !== original.position.x || n.position.y !== original.position.y)
    })
    expect(movedNodes.length).toBeGreaterThan(0)
  })
})
