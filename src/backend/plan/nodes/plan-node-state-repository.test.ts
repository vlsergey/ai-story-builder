import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { PlanNodeStateRepository } from "./plan-node-state-repository.js"

describe("PlanNodeStateRepository", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  const node = (title: string) => new PlanNodeRepository().insert({ title })
  const paths = (rows: { path: string }[]) => rows.map((r) => r.path).sort()

  it("gives a row a new revision on every write", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")

    const first = states.upsert(id, "", { content: "a", status: "GENERATED" })
    const second = states.upsert(id, "", { summary: "s" })

    expect(second.rev).not.toBe(first.rev)
    expect(second.content, "fields not written stay").toBe("a")
  })

  it("writes over a row only if nothing wrote it since the revision was read", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")
    const read = states.upsert(id, "", { status: "GENERATING" })
    states.upsert(id, "", { status: "OUTDATED" })

    expect(states.updateIfUnchanged(id, "", { content: "late", status: "GENERATED" }, read.rev)).toBeNull()
    expect(states.find(id, "")?.status).toBe("OUTDATED")

    const current = states.find(id, "")!
    expect(states.updateIfUnchanged(id, "", { content: "on time" }, current.rev)?.content).toBe("on time")
  })

  it("never writes a row that is gone, even with the revision it had", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")
    const read = states.upsert(id, "1:0", { status: "GENERATING" })
    states.deleteAtOrBelow("1:0")

    expect(states.updateIfUnchanged(id, "1:0", { status: "GENERATED" }, read.rev)).toBeNull()
    expect(states.find(id, "1:0")).toBeUndefined()
  })

  it("finds the rows of one iteration and the ones nested in it, not a sibling that shares its prefix", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")
    for (const path of ["", "27:1", "27:1/40:0", "27:10", "27:10/40:0", "27:2"]) states.upsert(id, path, {})

    expect(paths(states.findAtOrBelow("27:1"))).toEqual(["27:1", "27:1/40:0"])
    expect(paths(states.findAtPath("27:1"))).toEqual(["27:1"])
    expect(paths(states.findAtOrBelow(""))).toHaveLength(6)
  })

  it("deletes the iterations of a loop that are gone, with everything nested in them", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")
    const all = ["", "27:0", "27:1", "27:1/40:3", "27:2", "27:10", "2:5", "3:0/27:4"]
    for (const path of all) states.upsert(id, path, {})

    states.deleteIterationsWhere(27, "", (key) => Number(key) >= 2)

    expect(paths(states.findAll())).toEqual(["", "27:0", "27:1", "27:1/40:3", "2:5", "3:0/27:4"])
  })

  it("creates a row without a status as pending, not as answered", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")

    expect(states.upsert(id, "5:0", { summary: "note" }).status).toBe("OUTDATED")
    expect(states.updateIfUnchanged(id, "5:1", { summary: "note" }, "")?.status).toBe("OUTDATED")
  })

  it("demotes a node's rows in every iteration, only from the given statuses", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")
    states.upsert(id, "5:0", { status: "GENERATED" })
    states.upsert(id, "5:1", { status: "MANUAL" })
    states.upsert(id, "5:2", { status: "ERROR" })

    const demoted = states.setStatusForNode(id, ["GENERATED", "ERROR"], "OUTDATED")

    expect(paths(demoted)).toEqual(["5:0", "5:2"])
    expect(states.find(id, "5:1")?.status).toBe("MANUAL")
  })

  it("turns what a run left GENERATING into pending, and only that", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")
    states.upsert(id, "", { status: "GENERATING", content: "half" })
    states.upsert(id, "5:0", { status: "GENERATED", content: "done" })

    expect(states.resetInterrupted()).toBe(1)

    expect(states.find(id, "")).toMatchObject({ status: "OUTDATED", content: "half" })
    expect(states.find(id, "5:0")?.status).toBe("GENERATED")
  })

  it("goes with its node", () => {
    const states = new PlanNodeStateRepository()
    const id = node("A")
    states.upsert(id, "", { content: "x" })

    new PlanNodeRepository().delete(id)

    expect(states.findAll()).toEqual([])
  })
})
