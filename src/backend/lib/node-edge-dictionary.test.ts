import { describe, expect, it } from "vitest"
import { EDGE_TYPES_DEFS, NODE_TYPES } from "../../shared/node-edge-dictionary.js"
import type { PlanEdgeType } from "../../shared/plan-edge-types.js"
import type { PlanNodeType } from "../../shared/plan-node-types.js"

describe("node-edge-dictionary consistency", () => {
  // Helper to collect all node/edge IDs
  const nodeIds = NODE_TYPES.map((n) => n.id)
  const edgeIds = EDGE_TYPES_DEFS.map((e) => e.id)

  it("has unique node IDs", () => {
    const seen = new Set<PlanNodeType>()
    for (const node of NODE_TYPES) {
      expect(seen.has(node.id)).toBe(false)
      seen.add(node.id)
    }
  })

  it("has unique edge IDs", () => {
    const seen = new Set<PlanEdgeType>()
    for (const edge of EDGE_TYPES_DEFS) {
      expect(seen.has(edge.id)).toBe(false)
      seen.add(edge.id)
    }
  })

  it("node allowedOutgoingEdgeTypes correspond to edge allowedSourceNodeTypes", () => {
    for (const node of NODE_TYPES) {
      for (const edgeType of node.allowedOutgoingEdgeTypes) {
        const edge = EDGE_TYPES_DEFS.find((e) => e.id === edgeType)
        expect(edge, `Edge type ${edgeType} not found`).toBeDefined()
        expect(edge!.allowedSourceNodeTypes).toContain(node.id)
      }
    }
  })

  it("node allowedIncomingEdgeTypes correspond to edge allowedTargetNodeTypes", () => {
    for (const node of NODE_TYPES) {
      for (const edgeType of node.allowedIncomingEdgeTypes) {
        const edge = EDGE_TYPES_DEFS.find((e) => e.id === edgeType)
        expect(edge, `Edge type ${edgeType} not found`).toBeDefined()
        expect(edge!.allowedTargetNodeTypes).toContain(node.id)
      }
    }
  })

  it("edge allowedSourceNodeTypes correspond to node allowedOutgoingEdgeTypes", () => {
    for (const edge of EDGE_TYPES_DEFS) {
      for (const nodeType of edge.allowedSourceNodeTypes) {
        const node = NODE_TYPES.find((n) => n.id === nodeType)
        expect(node, `Node type ${nodeType} not found`).toBeDefined()
        expect(node!.allowedOutgoingEdgeTypes).toContain(edge.id)
      }
    }
  })

  it("edge allowedTargetNodeTypes correspond to node allowedIncomingEdgeTypes", () => {
    for (const edge of EDGE_TYPES_DEFS) {
      for (const nodeType of edge.allowedTargetNodeTypes) {
        const node = NODE_TYPES.find((n) => n.id === nodeType)
        expect(node, `Node type ${nodeType} not found`).toBeDefined()
        expect(node!.allowedIncomingEdgeTypes).toContain(edge.id)
      }
    }
  })

  it("all referenced node types exist", () => {
    for (const edge of EDGE_TYPES_DEFS) {
      for (const nodeType of edge.allowedSourceNodeTypes) {
        expect(nodeIds).toContain(nodeType)
      }
      for (const nodeType of edge.allowedTargetNodeTypes) {
        expect(nodeIds).toContain(nodeType)
      }
    }
  })

  it("all referenced edge types exist", () => {
    for (const node of NODE_TYPES) {
      for (const edgeType of node.allowedOutgoingEdgeTypes) {
        expect(edgeIds).toContain(edgeType)
      }
      for (const edgeType of node.allowedIncomingEdgeTypes) {
        expect(edgeIds).toContain(edgeType)
      }
    }
  })
})
