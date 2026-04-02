import dagre from '@dagrejs/dagre'
import { Node, Edge } from '@xyflow/react'

export interface HierarchicalLayoutOptions {
  nodesep?: number
  ranksep?: number
  edgesep?: number
  groupPadding?: number
  groupTopPadding?: number
  defaultNodeWidth?: number
  defaultNodeHeight?: number
  defaultGroupNodeWidth?: number
  defaultGroupNodeHeight?: number
}

export const defaultOptions: Required<HierarchicalLayoutOptions> = {
  nodesep: 60,
  ranksep: 120,
  edgesep: 120,
  groupPadding: 40,
  groupTopPadding: 80,
  defaultNodeWidth: 200,
  defaultNodeHeight: 80,
  defaultGroupNodeWidth: 400,
  defaultGroupNodeHeight: 300,
}

/**
 * Performs hierarchical layout accounting for groups (nodes with parentId).
 * Algorithm:
 * 1. Recursively processes each group (node with type === 'group')
 * 2. For each group, applies dagre layout to its immediate children
 * 3. Computes group dimensions based on children bounding box + padding
 * 4. Applies dagre layout to root nodes (no parentId) with computed dimensions
 * 5. Converts relative child positions to absolute
 *
 * Features:
 * - Edges between different hierarchy levels are accounted for in top‑level layout:
 *   if an edge leads to a descendant of a group node, it is treated as an edge to the group node.
 * - Nested groups are processed recursively.
 * - Group dimensions are computed dynamically based on content.
 */
export function applyHierarchicalLayout<N extends Node>(
  nodes: N[],
  edges: Edge[],
  options: HierarchicalLayoutOptions = {}
): N[] {
  const opts = { ...defaultOptions, ...options }
  
  // Create copies of nodes for modification
  const nodeMap = new Map<string, N>(nodes.map(n => [n.id, { ...n }]))
  const edgeList = [...edges]
  
  // Helper function to get children of a group
  function getChildren(parentId: string | null): N[] {
    return Array.from(nodeMap.values()).filter(n =>
      (parentId === null && !n.parentId) ||
      (parentId !== null && n.parentId === parentId)
    )
  }

  // Build map of parent to children for quick lookup
  const parentToChildren = new Map<string, N[]>()
  for (const node of Array.from(nodeMap.values())) {
    if (node.parentId) {
      if (!parentToChildren.has(node.parentId)) {
        parentToChildren.set(node.parentId, [])
      }
      parentToChildren.get(node.parentId)!.push(node)
    }
  }

  // Helper to check if a node has children
  function hasChildren(nodeId: string): boolean {
    return parentToChildren.has(nodeId)
  }

  // Function to get the root parent of a node (topmost group or the node itself if root)
  function getRootParent(nodeId: string): string {
    let current = nodeMap.get(nodeId)
    while (current?.parentId) {
      const parent = nodeMap.get(current.parentId)
      if (!parent) break
      current = parent
    }
    return current?.id ?? nodeId
  }

  // Helper to extract node dimensions (width/height) from node properties
  function getNodeSize(node: N): { width: number, height: number } {
    // Prefer explicit width/height properties
    if (node.width !== undefined && node.height !== undefined) {
      return { width: node.width, height: node.height }
    }
    if (hasChildren(node.id)) {
      return { width: opts.defaultGroupNodeWidth, height: opts.defaultGroupNodeHeight }
    } else {
      return { width: opts.defaultNodeWidth, height: opts.defaultNodeHeight }
    }
  }

  // Recursive group processing
  function processGroup(parentId: string | null): void {
    const children = getChildren(parentId)
    if (children.length === 0) {
      return
    }
    
    // Split children into parent nodes (those that have their own children) and leaf nodes
    const childParents = children.filter(c => hasChildren(c.id))
    const leafChildren = children.filter(c => !hasChildren(c.id))
    
    // Process nested parent nodes recursively – they will update their own dimensions in nodeMap
    for (const parent of childParents) {
      processGroup(parent.id)
    }
    
    // Collect all nodes for layout inside this group (including processed parent nodes)
    const allChildren = [...leafChildren, ...childParents]
    
    // Build size map for all children (leaf nodes and parent nodes)
    const groupSizes = new Map<string, { width: number, height: number }>()
    for (const child of allChildren) {
      // For parent nodes, dimensions are already stored in nodeMap after recursive processing
      const node = nodeMap.get(child.id)
      const size = node ? getNodeSize(node) : getNodeSize(child)
      groupSizes.set(child.id, size)
    }
    
    if (allChildren.length === 0) {
      // This case should not happen because children.length > 0, but keep for safety
      return
    }
    
    // Apply dagre layout to children of this group
    const g = new dagre.graphlib.Graph()
    g.setGraph({
      rankdir: 'LR',
      nodesep: opts.nodesep,
      ranksep: opts.ranksep,
      edgesep: opts.edgesep
    })
    g.setDefaultEdgeLabel(() => ({}))
    
    // Add nodes with their dimensions
    allChildren.forEach(child => {
      const size = groupSizes.get(child.id)!
      g.setNode(child.id, { width: size.width, height: size.height })
    })
    
    // Add edges that reside inside this group
    // (source and target are children of this group)
    const childIds = new Set(allChildren.map(c => c.id))
    edgeList.forEach(edge => {
      if (childIds.has(edge.source) && childIds.has(edge.target)) {
        g.setEdge(edge.source, edge.target)
      }
    })
    
    dagre.layout(g)
    
    // Update child positions relative to the group (top-left corner)
    allChildren.forEach(child => {
      const pos = g.node(child.id)
      if (pos) {
        const size = groupSizes.get(child.id)!
        // Convert center coordinates to top-left corner relative to group
        const topLeftX = pos.x - size.width / 2
        const topLeftY = pos.y - size.height / 2
        // Update position in nodeMap AND in the child object itself
        const childNode = nodeMap.get(child.id)
        if (childNode) {
          const updatedNode = {
            ...childNode,
            position: { x: topLeftX, y: topLeftY }
          }
          nodeMap.set(child.id, updatedNode)
          // Also update the child object in allChildren array (same reference)
          child.position.x = topLeftX
          child.position.y = topLeftY
        }
      }
    })
    
    // Compute bounding box for the group (this will shift node positions)
    const bbox = computeBoundingBox(allChildren, groupSizes, opts.groupPadding, opts.groupTopPadding, opts.defaultNodeWidth, opts.defaultNodeHeight)
    
    // After computeBoundingBox, node positions have been shifted
    // Update nodeMap with the new positions
    allChildren.forEach(child => {
      const nodeInMap = nodeMap.get(child.id)
      if (nodeInMap) {
        nodeMap.set(child.id, {
          ...nodeInMap,
          position: { x: child.position.x, y: child.position.y }
        })
      }
    })
    
    // If this group has a parent node, update its dimensions to match the bounding box
    if (parentId) {
      const parentNode = nodeMap.get(parentId)
      if (parentNode) {
        nodeMap.set(parentId, {
          ...parentNode,
          width: bbox.width,
          height: bbox.height,
        })
      }
    }
  }
  
  // Process root nodes (parentId === null) – this will update dimensions of all groups in nodeMap
  processGroup(null)
  
  // Now apply dagre layout to root nodes
  const rootNodes = getChildren(null)
  if (rootNodes.length === 0) {
    return Array.from(nodeMap.values())
  }
  
  const rootGraph = new dagre.graphlib.Graph()
  rootGraph.setGraph({
    rankdir: 'LR',
    nodesep: opts.nodesep,
    ranksep: opts.ranksep,
    edgesep: opts.edgesep
  })
  rootGraph.setDefaultEdgeLabel(() => ({}))
  
  // Add root nodes with their dimensions
  rootNodes.forEach(node => {
    // For any node, retrieve its up‑to‑date version from nodeMap (contains updated width/height)
    const nodeInMap = nodeMap.get(node.id)
    const size = getNodeSize(nodeInMap ?? node)
    rootGraph.setNode(node.id, size)
  })
  
  // Add edges between root nodes, accounting for cross‑level edges
  // For each edge find the root parents of source and target
  const rootIds = new Set(rootNodes.map(n => n.id))
  const rootEdges = new Set<string>() // store unique edges (sourceRoot,targetRoot)
  
  edgeList.forEach(edge => {
    const sourceRoot = getRootParent(edge.source)
    const targetRoot = getRootParent(edge.target)
    
    // If both root parents are root nodes (in rootIds)
    if (rootIds.has(sourceRoot) && rootIds.has(targetRoot)) {
      // Add edge between root parents (skip self‑loops)
      if (sourceRoot !== targetRoot) {
        const edgeKey = `${sourceRoot}->${targetRoot}`
        if (!rootEdges.has(edgeKey)) {
          rootEdges.add(edgeKey)
          rootGraph.setEdge(sourceRoot, targetRoot)
        }
      }
    }
  })
  
  dagre.layout(rootGraph)
  
  // Update positions of root nodes
  rootNodes.forEach(node => {
    const pos = rootGraph.node(node.id)
    if (pos) {
      const nodeCopy = nodeMap.get(node.id)
      if (nodeCopy) {
        // Convert center coordinates to top‑left corner
        nodeMap.set(node.id, {
          ...nodeCopy,
          position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 }
        })
      }
    }
  })
  
  // Return nodes with positions relative to their parent (or absolute for root nodes)
  return Array.from(nodeMap.values())
}

/**
 * Computes the bounding box for a set of nodes given their sizes and positions (top-left corners).
 * Returns width and height of the bounding box with padding.
 * @param topPadding If provided, used for top padding; otherwise uses padding for all sides.
 */
function computeBoundingBox(
  nodes: Node[],
  sizeMap: Map<string, { width: number, height: number }>,
  padding: number,
  topPadding?: number,
  defaultNodeWidth: number = 200,
  defaultNodeHeight: number = 80
): { width: number, height: number } {
  if (nodes.length === 0) {
    return { width: defaultNodeWidth, height: defaultNodeHeight }
  }
  
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  
  for (const node of nodes) {
    const size = sizeMap.get(node.id) || { width: defaultNodeWidth, height: defaultNodeHeight }
    const x = node.position.x
    const y = node.position.y
    
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x + size.width)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y + size.height)
  }
  
  const paddingTop = topPadding ?? padding
  const paddingBottom = padding
  const paddingLeft = padding
  const paddingRight = padding
  
  const width = maxX - minX + paddingLeft + paddingRight
  const height = maxY - minY + paddingTop + paddingBottom
  
  // Shift all node positions so that the bounding box starts at (paddingLeft, paddingTop)
  const offsetX = -minX + paddingLeft
  const offsetY = -minY + paddingTop
  
  for (const node of nodes) {
    const nodeCopy = node
    nodeCopy.position = {
      x: node.position.x + offsetX,
      y: node.position.y + offsetY
    }
  }
  
  return { width, height }
}
