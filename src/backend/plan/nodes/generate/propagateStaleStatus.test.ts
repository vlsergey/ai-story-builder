import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { PlanNodeStatus } from "../../../../shared/plan-graph.js"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { seedEdge as edge, seedNode as node, seedState, stateAt } from "../plan-node-fixtures.js"
import { propagateStaleStatus } from "./propagateStaleStatus.js"

/** Settings for a text node whose prompt reads the named inputs. */
const reads = (...titles: string[]) => JSON.stringify({ userPrompt: titles.map((t) => `{{[${t}]}}`).join("\n") })

/** Settings of a node the scheduler can regenerate, so that its stale status is work still to do. */
const PROMPTED = JSON.stringify({ userPrompt: "Сгенерируй." })

/** A loop that ran `length` iterations at `''`. */
function loop(title: string, length: number, status: PlanNodeStatus = "GENERATED"): number {
  return node({ title, type: "for-each", at: { "": { status, content: JSON.stringify({ length }) } } })
}

const statusAt = (id: number, path = "") => stateAt(id, path)?.status

describe("propagateStaleStatus", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  it("propagates OUTDATED forward through input edges", () => {
    const a = node({ title: "A", settings: PROMPTED, at: { "": "OUTDATED" } })
    const b = node({ title: "B", settings: reads("A"), at: { "": "GENERATED" } })
    const c = node({ title: "C", settings: reads("B"), at: { "": "GENERATED" } })
    edge(a, b)
    edge(b, c)

    propagateStaleStatus()

    expect(statusAt(b)).toBe("OUTDATED")
    expect(statusAt(c)).toBe("OUTDATED")
  })

  it("treats ERROR and EMPTY as stale sources too", () => {
    const err = node({ title: "Err", settings: PROMPTED, at: { "": "ERROR" } })
    const emp = node({ title: "Empty", settings: PROMPTED, at: { "": "EMPTY" } })
    const t1 = node({ title: "T1", settings: reads("Err"), at: { "": "GENERATED" } })
    const t2 = node({ title: "T2", settings: reads("Empty"), at: { "": "GENERATED" } })
    edge(err, t1)
    edge(emp, t2)

    propagateStaleStatus()

    expect(statusAt(t1)).toBe("OUTDATED")
    expect(statusAt(t2)).toBe("OUTDATED")
  })

  it("treats a node that never ran as stale", () => {
    const pending = node({ title: "New", settings: PROMPTED })
    const reader = node({ title: "Reader", settings: reads("New"), at: { "": "GENERATED" } })
    edge(pending, reader)

    propagateStaleStatus()

    expect(statusAt(reader)).toBe("OUTDATED")
  })

  it("does not demote a consumer whose prompt does not read the stale source", () => {
    const stale = node({ title: "Мир", settings: PROMPTED, at: { "": "OUTDATED" } })
    const other = node({ title: "Стиль", at: { "": "GENERATED" } })
    const reader = node({ title: "Проза", settings: reads("Стиль"), at: { "": "GENERATED" } })
    edge(stale, reader)
    edge(other, reader)

    propagateStaleStatus()

    expect(statusAt(reader)).toBe("GENERATED")
  })

  it("counts a source named inside a helper call as read", () => {
    const stale = node({ title: "Чанк", settings: PROMPTED, at: { "": "OUTDATED" } })
    const reader = node({
      title: "Проза",
      settings: JSON.stringify({ userPrompt: '{{#if (contains [Чанк] "mode=fragment")}}фрагмент{{/if}}' }),
      at: { "": "GENERATED" },
    })
    edge(stale, reader)

    propagateStaleStatus()

    expect(statusAt(reader)).toBe("OUTDATED")
  })

  it("never touches MANUAL — user-authoritative", () => {
    const stale = node({ title: "S", settings: PROMPTED, at: { "": "OUTDATED" } })
    const manual = node({ title: "M", at: { "": "MANUAL" } })
    edge(stale, manual)

    propagateStaleStatus()

    expect(statusAt(manual)).toBe("MANUAL")
  })

  it("is a no-op when nothing is stale", () => {
    const a = node({ title: "A", at: { "": "GENERATED" } })
    const b = node({ title: "B", at: { "": "GENERATED" } })
    edge(a, b)

    const result = propagateStaleStatus()

    expect(result.marked).toEqual([])
    expect(statusAt(a)).toBe("GENERATED")
    expect(statusAt(b)).toBe("GENERATED")
  })

  it("treats MANUAL as stale when regenerateManual=true", () => {
    const manual = node({ title: "M", settings: PROMPTED, at: { "": "MANUAL" } })
    const downstream = node({ title: "D", settings: reads("M"), at: { "": "GENERATED" } })
    edge(manual, downstream)

    propagateStaleStatus({ regenerateManual: true, regenerateGenerated: false })

    expect(statusAt(downstream)).toBe("OUTDATED")
    // MANUAL itself is still MANUAL — we only flip GENERATED → OUTDATED.
    expect(statusAt(manual)).toBe("MANUAL")
  })

  it("does not treat a hand-written source as stale, even when regenerateManual=true", () => {
    // A synopsis the user typed has no prompt: «regenerate manual» cannot redo
    // it, so nothing downstream has to wait for it.
    const synopsis = node({ title: "Синопсис", at: { "": { status: "MANUAL", content: "…" } } })
    const world = node({ title: "Мир", settings: reads("Синопсис"), at: { "": "GENERATED" } })
    edge(synopsis, world)

    propagateStaleStatus({ regenerateManual: true, regenerateGenerated: false })

    expect(statusAt(world)).toBe("GENERATED")
  })

  it("treats GENERATED as stale when regenerateGenerated=true (full re-run)", () => {
    const root = node({ title: "R", settings: PROMPTED, at: { "": "GENERATED" } })
    const downstream = node({ title: "D", settings: reads("R"), at: { "": "GENERATED" } })
    edge(root, downstream)

    propagateStaleStatus({ regenerateManual: false, regenerateGenerated: true })

    expect(statusAt(downstream)).toBe("OUTDATED")
    // root has no upstream stale source — stays GENERATED.
    expect(statusAt(root)).toBe("GENERATED")
  })

  it("EMPTY upstream still propagates forward through edges", () => {
    const empty = node({ title: "Empty", settings: PROMPTED, at: { "": "EMPTY" } })
    const downstream = node({ title: "D", settings: reads("Empty"), at: { "": "GENERATED" } })
    edge(empty, downstream)

    propagateStaleStatus()

    expect(statusAt(downstream)).toBe("OUTDATED")
  })

  it("does NOT propagate forward from an EMPTY deterministic node whose inputs are settled", () => {
    // A merge that aggregates nothing is EMPTY — and that is its final,
    // correct answer. Re-running it produces the same emptiness, so everything
    // reading from it is still fresh.
    const agg = node({ title: "Agg", type: "merge", at: { "": "EMPTY" } })
    const reader = node({ title: "Notes", at: { "": "GENERATED" } })
    edge(agg, reader)

    const result = propagateStaleStatus()

    expect(result.marked).toEqual([])
    expect(statusAt(reader)).toBe("GENERATED")
  })

  it("DOES propagate forward from an EMPTY deterministic node when its own input is stale", () => {
    // Emptiness is only settled while nothing upstream is pending. An OUTDATED
    // source means the merge is about to change, so downstream must be demoted.
    const src = node({ title: "Src", settings: PROMPTED, at: { "": "OUTDATED" } })
    const agg = node({ title: "PrevAgg", type: "merge", at: { "": "EMPTY" } })
    const reader = node({ title: "Notes", settings: reads("PrevAgg"), at: { "": "GENERATED" } })
    edge(src, agg)
    edge(agg, reader)

    propagateStaleStatus()

    expect(statusAt(reader)).toBe("OUTDATED")
  })

  it("carries the exemption through a chain of EMPTY deterministic nodes", () => {
    const agg = node({ title: "Agg", type: "merge", at: { "": "EMPTY" } })
    const page = node({ title: "Page", type: "format", at: { "": "EMPTY" } })
    const reader = node({ title: "Reader", at: { "": "GENERATED" } })
    edge(agg, page)
    edge(page, reader)

    expect(propagateStaleStatus().marked).toEqual([])
  })

  it("still propagates forward from an EMPTY LLM node — its emptiness is not an answer", () => {
    // A text node that came back empty may well come back non-empty next time,
    // so the exemption must not reach generative types.
    const readers: number[] = []
    for (const type of ["text", "split", "lore", "fix-problems"] as const) {
      const empty = node({ title: `E-${type}`, type, settings: PROMPTED, at: { "": "EMPTY" } })
      const reader = node({ title: `R-${type}`, settings: reads(`E-${type}`), at: { "": "GENERATED" } })
      edge(empty, reader)
      readers.push(reader)
    }

    propagateStaleStatus()

    for (const reader of readers) expect(statusAt(reader), `${reader}`).toBe("OUTDATED")
  })

  it("treats a loop over an empty list as a final answer", () => {
    const list = node({ title: "List", type: "split", at: { "": { status: "GENERATED", content: "[]" } } })
    const loopId = loop("Loop", 0, "EMPTY")
    const draft = node({ title: "Draft", type: "merge", at: { "": "GENERATED" } })
    edge(list, loopId, "textArray")
    edge(loopId, draft, "textArray")

    expect(propagateStaleStatus().marked).toEqual([])
  })
})

describe("propagateStaleStatus in loops", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  it("makes a loop with a stale child in one of its iterations need a visit", () => {
    const c1 = loop("C1", 2)
    node({ title: "Old", parent: c1, settings: PROMPTED, at: { [`${c1}:0`]: "GENERATED", [`${c1}:1`]: "OUTDATED" } })
    const c2 = loop("C2", 1)
    node({ title: "Broken", parent: c2, settings: PROMPTED, at: { [`${c2}:0`]: "ERROR" } })

    propagateStaleStatus()

    expect(statusAt(c1)).toBe("OUTDATED")
    expect(statusAt(c2)).toBe("OUTDATED")
  })

  it("does not make a loop need a visit for an EMPTY child — a merge of nothing is an answer", () => {
    const c = loop("ForEach", 1)
    node({ title: "PrevAgg", type: "merge", parent: c, at: { [`${c}:0`]: "EMPTY" } })
    node({ title: "Real child", parent: c, at: { [`${c}:0`]: "GENERATED" } })

    const result = propagateStaleStatus()

    expect(result.marked).toEqual([])
    expect(statusAt(c)).toBe("GENERATED")
  })

  it("makes a loop need a visit when a child has not run in one of its iterations", () => {
    const c = loop("Loop", 2)
    node({ title: "Profile", parent: c, settings: PROMPTED, at: { [`${c}:0`]: "GENERATED" } })

    propagateStaleStatus()

    expect(statusAt(c)).toBe("OUTDATED")
  })

  it("ignores rows left under iterations the loop no longer has", () => {
    const c = loop("Loop", 1)
    node({
      title: "Profile",
      parent: c,
      settings: PROMPTED,
      at: { [`${c}:0`]: "GENERATED", [`${c}:1`]: "OUTDATED" },
    })

    expect(propagateStaleStatus().marked).toEqual([])
  })

  it("demotes the loop's readers only when its output is stale", () => {
    const c = loop("Loop", 2)
    const side = node({ title: "Side note", parent: c, settings: PROMPTED, at: { [`${c}:0`]: "ERROR" } })
    const out = node({ title: "Out", type: "for-each-output", parent: c })
    seedState(out, `${c}:0`, { status: "GENERATED", content: "a" })
    seedState(out, `${c}:1`, { status: "GENERATED", content: "b" })
    seedState(side, `${c}:1`, "GENERATED")
    const draft = node({ title: "Draft", type: "merge", at: { "": "GENERATED" } })
    edge(c, draft, "textArray")

    propagateStaleStatus()

    expect(statusAt(c), "the loop has work to do").toBe("OUTDATED")
    expect(statusAt(draft), "what the loop hands on is not changing").toBe("GENERATED")

    seedState(out, `${c}:1`, "OUTDATED")
    propagateStaleStatus()

    expect(statusAt(draft)).toBe("OUTDATED")
  })

  it("reaches every iteration from a stale source outside the loop", () => {
    const style = node({ title: "Style", settings: PROMPTED, at: { "": "OUTDATED" } })
    const c = loop("Loop", 2)
    const profile = node({
      title: "Profile",
      parent: c,
      settings: reads("Style"),
      at: { [`${c}:0`]: "GENERATED", [`${c}:1`]: "GENERATED" },
    })
    edge(style, profile)

    propagateStaleStatus()

    expect(statusAt(profile, `${c}:0`)).toBe("OUTDATED")
    expect(statusAt(profile, `${c}:1`)).toBe("OUTDATED")
    expect(statusAt(c)).toBe("OUTDATED")
  })

  it("keeps a stale node inside one iteration from reaching the others", () => {
    const c = loop("Loop", 2)
    const draft = node({
      title: "Draft",
      parent: c,
      settings: PROMPTED,
      at: { [`${c}:0`]: "OUTDATED", [`${c}:1`]: "GENERATED" },
    })
    const polish = node({
      title: "Polish",
      parent: c,
      settings: reads("Draft"),
      at: { [`${c}:0`]: "GENERATED", [`${c}:1`]: "GENERATED" },
    })
    edge(draft, polish)

    propagateStaleStatus()

    expect(statusAt(polish, `${c}:0`)).toBe("OUTDATED")
    expect(statusAt(polish, `${c}:1`)).toBe("GENERATED")
  })

  it("does not demote the elements of a stale loop — the loop rewrites only the ones that changed", () => {
    const c = loop("Loop", 1, "OUTDATED")
    const element = node({ title: "Element", type: "for-each-input", parent: c, at: { [`${c}:0`]: "GENERATED" } })

    propagateStaleStatus()

    expect(statusAt(element, `${c}:0`)).toBe("GENERATED")
  })

  it("makes a later iteration's memory stale when an earlier output is", () => {
    const c = loop("Scenes", 3)
    const out = node({
      title: "Out",
      type: "for-each-output",
      parent: c,
      at: { [`${c}:0`]: "GENERATED", [`${c}:1`]: "OUTDATED", [`${c}:2`]: "GENERATED" },
    })
    const previous = node({
      title: "Previous",
      type: "for-each-prev-outputs",
      parent: c,
      at: { [`${c}:0`]: "EMPTY", [`${c}:1`]: "GENERATED", [`${c}:2`]: "GENERATED" },
    })
    void out

    propagateStaleStatus()

    expect(statusAt(previous, `${c}:1`), "reads only iteration 0").toBe("GENERATED")
    expect(statusAt(previous, `${c}:2`), "reads iteration 1").toBe("OUTDATED")
  })

  it("leaves a whole loop alone when only its prev-outputs aggregate is EMPTY", () => {
    // End-to-end shape of the real graph: one legitimately-EMPTY merge fed six
    // siblings, which pre-marked them OUTDATED, which promoted the loop, which
    // re-ran an hour of prose. Nothing here should move.
    const c = loop("Loop", 1)
    const at0 = (status: PlanNodeStatus) => ({ [`${c}:0`]: status })
    const prev = node({ title: "Prev", type: "for-each-prev-outputs", parent: c, at: at0("EMPTY") })
    const agg = node({ title: "Agg", type: "merge", parent: c, at: at0("EMPTY") })
    edge(prev, agg, "textArray")
    const readers = ["Notes", "Prose", "Expand", "Polish A", "Polish B"].map((title) => {
      const id = node({ title, parent: c, at: at0("GENERATED") })
      edge(agg, id)
      return id
    })
    const out = node({ title: "Out", type: "for-each-output", parent: c, at: at0("GENERATED") })
    edge(readers[4], out)
    const downstream = node({ title: "Draft", type: "merge", at: { "": "GENERATED" } })
    edge(c, downstream, "textArray")

    const result = propagateStaleStatus()

    expect(result.marked).toEqual([])
    expect(statusAt(c), "loop").toBe("GENERATED")
    expect(statusAt(downstream), "downstream of the loop").toBe("GENERATED")
    for (const id of readers) expect(statusAt(id, `${c}:0`), `${id}`).toBe("GENERATED")
  })
})
