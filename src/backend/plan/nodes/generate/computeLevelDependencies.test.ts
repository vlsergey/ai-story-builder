import { describe, expect, it } from "vitest"
import type { PlanEdgeRow, PlanNodeRow } from "../../../../shared/plan-graph.js"
import { computeLevelDependencies } from "./computeLevelDependencies.js"

function node(id: number, parent_id: number | null = null): PlanNodeRow {
  return {
    id,
    parent_id,
    title: `n${id}`,
    type: "text",
    content: null,
    position: 0,
    created_at: "",
    x: 0,
    y: 0,
    summary: null,
    ai_sync_info: null,
    word_count: 0,
    char_count: 0,
    byte_count: 0,
    review_base_content: null,
    ai_improve_instruction: null,
    node_type_settings: null,
    status: "EMPTY",
    ai_settings: null,
    in_review: 0,
    width: null,
    height: null,
  } as PlanNodeRow
}

function edge(id: number, from: number, to: number): PlanEdgeRow {
  return { id, from_node_id: from, to_node_id: to, type: "text", position: 0, label: null, template: null }
}

describe("computeLevelDependencies", () => {
  it("treats sibling-to-sibling edges as direct dependencies", () => {
    const a = node(1)
    const b = node(2)
    const allNodes = [a, b]
    const allEdges = [edge(10, 1, 2)]

    const r = computeLevelDependencies({ parentId: null, allNodes, allEdges })
    expect(r.incomingEdges.get(2)).toEqual([1])
    expect(r.outgoingEdges.get(1)).toEqual([2])
    expect(r.incomingEdges.get(1)).toEqual([])
  })

  it("projects cross-boundary IN edges to the enclosing sibling — the fiction-arc bug", () => {
    // Top-level: #20 (for-each), #30 (merge), #31 (for-each)
    // Inside #31: #34 (text). Edge #30 → #34 lands inside #31.
    // Expected: #31 depends on #30 at top level.
    const n20 = node(20)
    const n30 = node(30)
    const n31 = node(31)
    const n34 = node(34, 31)
    const allNodes = [n20, n30, n31, n34]
    const allEdges = [edge(101, 30, 34)]

    const r = computeLevelDependencies({ parentId: null, allNodes, allEdges })
    expect(r.incomingEdges.get(31), "#31 should now depend on #30").toEqual([30])
    expect(r.outgoingEdges.get(30)).toEqual([31])
    // #34 isn't at this level
    expect(r.incomingEdges.has(34)).toBe(false)
  })

  it("projects cross-boundary OUT edges to the enclosing sibling", () => {
    // Top-level: #20 (for-each), #30 (merge).
    // Inside #20: #29 (for-each-output). Edge #29 → #30 leaves the for-each.
    // Expected: #30 depends on #20 (since something inside #20 feeds #30).
    const n20 = node(20)
    const n30 = node(30)
    const n29 = node(29, 20)
    const allNodes = [n20, n30, n29]
    const allEdges = [edge(201, 29, 30)]

    const r = computeLevelDependencies({ parentId: null, allNodes, allEdges })
    expect(r.incomingEdges.get(30)).toEqual([20])
    expect(r.outgoingEdges.get(20)).toEqual([30])
  })

  it("ignores edges internal to a single sibling subtree", () => {
    // Edge inside #20 between two of its children should not show up at top level.
    const n20 = node(20)
    const n21 = node(21, 20)
    const n22 = node(22, 20)
    const allNodes = [n20, n21, n22]
    const allEdges = [edge(301, 21, 22)]

    const r = computeLevelDependencies({ parentId: null, allNodes, allEdges })
    expect(r.incomingEdges.get(20)).toEqual([])
    expect(r.outgoingEdges.get(20)).toEqual([])
  })

  it("inner level (parentId != null) sees its own siblings and their cross-boundary edges", () => {
    // Inside #20: #21, #22. Edge from some outside node to #21 should not show
    // up as inner dependency (it crosses up out of this level).
    const n20 = node(20)
    const n21 = node(21, 20)
    const n22 = node(22, 20)
    const outsider = node(99)
    const allNodes = [n20, n21, n22, outsider]
    const allEdges = [edge(401, 99, 21), edge(402, 21, 22)]

    const r = computeLevelDependencies({ parentId: 20, allNodes, allEdges })
    expect(r.nodes.map((n) => n.id).sort()).toEqual([21, 22])
    // External edge 99 → 21 projects to nothing at parentId=20 level (99 is outside).
    expect(r.incomingEdges.get(21)).toEqual([])
    // Internal edge 21 → 22 stays.
    expect(r.incomingEdges.get(22)).toEqual([21])
  })

  it("deduplicates when multiple internal edges project to the same sibling pair", () => {
    // Two inside-of-#31 nodes each read from #30 — that's still one #30 → #31 dep.
    const n30 = node(30)
    const n31 = node(31)
    const n34 = node(34, 31)
    const n35 = node(35, 31)
    const allNodes = [n30, n31, n34, n35]
    const allEdges = [edge(501, 30, 34), edge(502, 30, 35)]

    const r = computeLevelDependencies({ parentId: null, allNodes, allEdges })
    expect(r.incomingEdges.get(31)).toEqual([30])
    expect(r.outgoingEdges.get(30)).toEqual([31])
  })
})
