import type { Edge, Node } from "@xyflow/react"
import ELK, { type LayoutOptions, type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js"

const DEFAULT_WIDTH = 200
const DEFAULT_HEIGHT = 80
const ELK_SPACING_NODE_NODE = 100
const ELK_SPACING_NODE_NODE_BETWEEN_LAYERS = 80

const LAYOUT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.spacing.nodeNodeBetweenLayers": String(ELK_SPACING_NODE_NODE_BETWEEN_LAYERS),
  "elk.padding": "[top=100,left=40,bottom=60,right=40]",
  "elk.spacing.nodeNode": String(ELK_SPACING_NODE_NODE),
}

const elk = new ELK()

export async function applyHierarchicalLayout<N extends Node>(nodes: N[], edges: Edge[]): Promise<N[]> {
  const nodesMap: Record<string, ElkNode> = {}
  nodes.forEach((node) => {
    nodesMap[node.id] = {
      id: node.id,
      width: node.width ?? DEFAULT_WIDTH,
      height: node.height ?? DEFAULT_HEIGHT,
      children: [],
      layoutOptions: LAYOUT_OPTIONS,
    }
  })

  const rootNodes: ElkNode[] = []

  nodes.forEach((node) => {
    const elkNode = nodesMap[node.id]
    if (node.parentId && nodesMap[node.parentId]) {
      nodesMap[node.parentId].children?.push(elkNode)
    } else {
      rootNodes.push(elkNode)
    }
  })

  const elkEdges: ElkExtendedEdge[] = edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }))

  const graph: ElkNode = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: rootNodes,
    edges: elkEdges,
  }

  const laidOutGraph = await elk.layout(graph)

  const flatNodes = (elkNodes: ElkNode[]): ElkNode[] => {
    return elkNodes.flatMap((n) => [n, ...(n.children ? flatNodes(n.children) : [])])
  }

  const results = flatNodes(laidOutGraph.children || [])

  // Обновляем исходные ноды
  return nodes.map((node) => {
    const res = results.find((r) => r.id === node.id)
    let newNode: N = node
    if (res != null) {
      newNode = {
        ...newNode,
        position: {
          x: res.x,
          y: res.y,
        },
        height: res.height,
        width: res.width,
      }
    }
    return newNode
  })
}
