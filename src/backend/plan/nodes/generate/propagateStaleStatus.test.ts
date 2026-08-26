import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan-node-repository.js"
import { propagateStaleStatus } from "./propagateStaleStatus.js"

describe("propagateStaleStatus", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  it("propagates OUTDATED forward through input edges", () => {
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const a = nodes.insert({ title: "A", type: "text", parent_id: null, status: "OUTDATED" })
    const b = nodes.insert({ title: "B", type: "text", parent_id: null, status: "GENERATED" })
    const c = nodes.insert({ title: "C", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: a, to_node_id: b, type: "text" })
    edges.insert({ from_node_id: b, to_node_id: c, type: "text" })

    propagateStaleStatus()

    expect(nodes.findById(b)!.status).toBe("OUTDATED")
    expect(nodes.findById(c)!.status).toBe("OUTDATED")
  })

  it("propagates OUTDATED upward into a GENERATED container when a descendant is stale", () => {
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const container = nodes.insert({ title: "Cycle", type: "for-each", parent_id: null, status: "GENERATED" })
    const child = nodes.insert({ title: "Profile", type: "text", parent_id: container, status: "OUTDATED" })
    const downstream = nodes.insert({ title: "Bible", type: "merge", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: container, to_node_id: downstream, type: "text" })

    propagateStaleStatus()

    expect(nodes.findById(container)!.status, "container marked from descendant").toBe("OUTDATED")
    expect(nodes.findById(downstream)!.status, "downstream marked from container").toBe("OUTDATED")
    void child
  })

  it("treats ERROR and EMPTY as stale sources too", () => {
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const err = nodes.insert({ title: "Err", type: "text", parent_id: null, status: "ERROR" })
    const emp = nodes.insert({ title: "Empty", type: "text", parent_id: null, status: "EMPTY" })
    const t1 = nodes.insert({ title: "T1", type: "text", parent_id: null, status: "GENERATED" })
    const t2 = nodes.insert({ title: "T2", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: err, to_node_id: t1, type: "text" })
    edges.insert({ from_node_id: emp, to_node_id: t2, type: "text" })

    propagateStaleStatus()

    expect(nodes.findById(t1)!.status).toBe("OUTDATED")
    expect(nodes.findById(t2)!.status).toBe("OUTDATED")
  })

  it("never touches MANUAL — user-authoritative", () => {
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const stale = nodes.insert({ title: "S", type: "text", parent_id: null, status: "OUTDATED" })
    const manual = nodes.insert({ title: "M", type: "text", parent_id: null, status: "MANUAL" })
    edges.insert({ from_node_id: stale, to_node_id: manual, type: "text" })

    propagateStaleStatus()

    expect(nodes.findById(manual)!.status).toBe("MANUAL")
  })

  it("is a no-op when nothing is stale", () => {
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const a = nodes.insert({ title: "A", type: "text", parent_id: null, status: "GENERATED" })
    const b = nodes.insert({ title: "B", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: a, to_node_id: b, type: "text" })

    const result = propagateStaleStatus()

    expect(result.markedNodeIds).toEqual([])
    expect(nodes.findById(a)!.status).toBe("GENERATED")
    expect(nodes.findById(b)!.status).toBe("GENERATED")
  })

  it("treats MANUAL as stale when regenerateManual=true", () => {
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const manual = nodes.insert({ title: "M", type: "text", parent_id: null, status: "MANUAL" })
    const downstream = nodes.insert({ title: "D", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: manual, to_node_id: downstream, type: "text" })

    propagateStaleStatus({ regenerateManual: true, regenerateGenerated: false })

    expect(nodes.findById(downstream)!.status).toBe("OUTDATED")
    // MANUAL itself is still MANUAL — we only flip GENERATED → OUTDATED.
    expect(nodes.findById(manual)!.status).toBe("MANUAL")
  })

  it("treats GENERATED as stale when regenerateGenerated=true (full re-run)", () => {
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const root = nodes.insert({ title: "R", type: "text", parent_id: null, status: "GENERATED" })
    const downstream = nodes.insert({ title: "D", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: root, to_node_id: downstream, type: "text" })

    propagateStaleStatus({ regenerateManual: false, regenerateGenerated: true })

    expect(nodes.findById(downstream)!.status).toBe("OUTDATED")
    // root has no upstream stale source — stays GENERATED.
    expect(nodes.findById(root)!.status).toBe("GENERATED")
  })

  it("does NOT bottom-up promote a container whose only stale descendant is EMPTY", () => {
    // Reproduces the «Сборка предыдущих сцен» trap: a merge node inside a for-each
    // is legitimately EMPTY on iteration 0 because it has no previous iterations
    // to aggregate. Bottom-up propagation must not treat that EMPTY as work-pending
    // and promote the (correctly GENERATED) for-each container to OUTDATED.
    const nodes = new PlanNodeRepository()
    new PlanEdgeRepository()
    const container = nodes.insert({ title: "ForEach", type: "for-each", parent_id: null, status: "GENERATED" })
    nodes.insert({ title: "PrevAgg", type: "merge", parent_id: container, status: "EMPTY" })
    nodes.insert({ title: "Real child", type: "text", parent_id: container, status: "GENERATED" })

    const result = propagateStaleStatus()

    expect(result.markedNodeIds).toEqual([])
    expect(nodes.findById(container)!.status).toBe("GENERATED")
  })

  it("still bottom-up promotes a container when a descendant is OUTDATED or ERROR", () => {
    // Sanity check that the EMPTY exemption above didn't accidentally turn off
    // bottom-up entirely. OUTDATED / ERROR descendants must still promote.
    const nodes = new PlanNodeRepository()
    new PlanEdgeRepository()
    const c1 = nodes.insert({ title: "C1", type: "for-each", parent_id: null, status: "GENERATED" })
    nodes.insert({ title: "OldChild", type: "text", parent_id: c1, status: "OUTDATED" })
    const c2 = nodes.insert({ title: "C2", type: "for-each", parent_id: null, status: "GENERATED" })
    nodes.insert({ title: "BrokenChild", type: "text", parent_id: c2, status: "ERROR" })

    propagateStaleStatus()

    expect(nodes.findById(c1)!.status).toBe("OUTDATED")
    expect(nodes.findById(c2)!.status).toBe("OUTDATED")
  })

  it("for-each-input child of a stale for-each container is demoted", () => {
    // for-each-input has no incoming edges (its content is populated by the
    // parent for-each container) and no children, so neither forward nor
    // bottom-up rule fires for it. Without an explicit top-down rule it
    // stays GENERATED while the rest of the iteration tree is OUTDATED —
    // looks confusing in the UI and blocks summary regeneration on the
    // mounted iteration row.
    const nodes = new PlanNodeRepository()
    new PlanEdgeRepository()
    const container = nodes.insert({ title: "Loop", type: "for-each", parent_id: null, status: "OUTDATED" })
    const internalInput = nodes.insert({
      title: "Element",
      type: "for-each-input",
      parent_id: container,
      status: "GENERATED",
    })

    propagateStaleStatus()

    expect(nodes.findById(internalInput)!.status).toBe("OUTDATED")
  })

  it("EMPTY upstream still propagates forward through edges (forward rule unchanged)", () => {
    // The exemption is bottom-up-only. An EMPTY node still blocks anything that
    // reads from it via an input edge — downstream can't be considered fresh.
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const empty = nodes.insert({ title: "Empty", type: "text", parent_id: null, status: "EMPTY" })
    const downstream = nodes.insert({ title: "D", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: empty, to_node_id: downstream, type: "text" })

    propagateStaleStatus()

    expect(nodes.findById(downstream)!.status).toBe("OUTDATED")
  })

  it("does NOT propagate forward from an EMPTY deterministic node whose inputs are settled", () => {
    // The «Сборка предыдущих чанков» trap, forward edition. A merge node inside
    // a for-each aggregates previous iterations; on iteration 0 there are none,
    // so it is EMPTY — and that is its final, correct answer. Re-running it
    // produces the same emptiness, so everything reading from it is still fresh.
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const prev = nodes.insert({ title: "Prev", type: "for-each-prev-outputs", parent_id: null, status: "GENERATED" })
    const agg = nodes.insert({ title: "PrevAgg", type: "merge", parent_id: null, status: "EMPTY" })
    const reader = nodes.insert({ title: "Notes", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: prev, to_node_id: agg, type: "textArray" })
    edges.insert({ from_node_id: agg, to_node_id: reader, type: "text" })

    const result = propagateStaleStatus()

    expect(result.markedNodeIds).toEqual([])
    expect(nodes.findById(reader)!.status).toBe("GENERATED")
  })

  it("DOES propagate forward from an EMPTY deterministic node when its own input is stale", () => {
    // Emptiness is only settled while nothing upstream is pending. An OUTDATED
    // source means the merge is about to change, so downstream must be demoted.
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const src = nodes.insert({ title: "Src", type: "text", parent_id: null, status: "OUTDATED" })
    const agg = nodes.insert({ title: "PrevAgg", type: "merge", parent_id: null, status: "EMPTY" })
    const reader = nodes.insert({ title: "Notes", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: src, to_node_id: agg, type: "text" })
    edges.insert({ from_node_id: agg, to_node_id: reader, type: "text" })

    propagateStaleStatus()

    expect(nodes.findById(reader)!.status).toBe("OUTDATED")
  })

  it("carries the exemption through a chain of EMPTY deterministic nodes", () => {
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const prev = nodes.insert({ title: "Prev", type: "for-each-prev-outputs", parent_id: null, status: "GENERATED" })
    const agg = nodes.insert({ title: "Agg", type: "merge", parent_id: null, status: "EMPTY" })
    const page = nodes.insert({ title: "Page", type: "format", parent_id: null, status: "EMPTY" })
    const reader = nodes.insert({ title: "Reader", type: "text", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: prev, to_node_id: agg, type: "textArray" })
    edges.insert({ from_node_id: agg, to_node_id: page, type: "text" })
    edges.insert({ from_node_id: page, to_node_id: reader, type: "text" })

    expect(propagateStaleStatus().markedNodeIds).toEqual([])
  })

  it("still propagates forward from an EMPTY LLM node — its emptiness is not an answer", () => {
    // A text node that came back empty may well come back non-empty next time,
    // so the exemption must not reach generative types.
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    for (const type of ["text", "split", "lore", "fix-problems"] as const) {
      const empty = nodes.insert({ title: `E-${type}`, type, parent_id: null, status: "EMPTY" })
      const reader = nodes.insert({ title: `R-${type}`, type: "text", parent_id: null, status: "GENERATED" })
      edges.insert({ from_node_id: empty, to_node_id: reader, type: "text" })
    }

    propagateStaleStatus()

    for (const n of nodes.findAll()) {
      if (n.title.startsWith("R-")) expect(n.status, n.title).toBe("OUTDATED")
    }
  })

  it("leaves a whole for-each loop alone when only its prev-outputs aggregate is EMPTY", () => {
    // End-to-end shape of the real graph: one legitimately-EMPTY merge fed six
    // siblings, which pre-marked them OUTDATED, which bottom-up promoted the
    // container, which re-ran an hour of prose. Nothing here should move.
    const nodes = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const loop = nodes.insert({ title: "Loop", type: "for-each", parent_id: null, status: "GENERATED" })
    const prev = nodes.insert({ title: "Prev", type: "for-each-prev-outputs", parent_id: loop, status: "GENERATED" })
    const agg = nodes.insert({ title: "Agg", type: "merge", parent_id: loop, status: "EMPTY" })
    edges.insert({ from_node_id: prev, to_node_id: agg, type: "textArray" })
    const readers = ["Notes", "Prose", "Expand", "Polish A", "Polish B", "Out"].map((title) => {
      const id = nodes.insert({ title, type: "text", parent_id: loop, status: "GENERATED" })
      edges.insert({ from_node_id: agg, to_node_id: id, type: "text" })
      return id
    })
    const downstream = nodes.insert({ title: "Draft", type: "merge", parent_id: null, status: "GENERATED" })
    edges.insert({ from_node_id: loop, to_node_id: downstream, type: "textArray" })

    const result = propagateStaleStatus()

    expect(result.markedNodeIds).toEqual([])
    expect(nodes.findById(loop)!.status, "container").toBe("GENERATED")
    expect(nodes.findById(downstream)!.status, "downstream of container").toBe("GENERATED")
    for (const id of readers) expect(nodes.findById(id)!.status, nodes.findById(id)!.title).toBe("GENERATED")
  })
})
