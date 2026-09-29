import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { seedEdge, seedNode } from "../plan-node-fixtures.js"
import { PlanNodeService } from "../plan-node-service.js"
import { regenerateTreeNodesContents } from "./regenerateTreeNodesContents.js"

const PROMPT = JSON.stringify({ userPrompt: "stub" })

/**
 * A safeguard, not a scenario: no correct graph keeps demoting its own nodes,
 * so this builds one that does by stubbing regeneration. Everything a user can
 * do to a run is covered by the scenarios in `plan/scenario`.
 */
describe("a run that does not converge", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => {
    tearDownTestDb()
    vi.restoreAllMocks()
  })

  it("fails instead of reporting success", async () => {
    const a = seedNode({ title: "A", settings: PROMPT, at: { "": "OUTDATED" } })
    const b = seedNode({ title: "B", settings: PROMPT, at: { "": "OUTDATED" } })
    const c = seedNode({ title: "C", settings: PROMPT, at: { "": "OUTDATED" } })
    seedEdge(a, c)
    seedEdge(b, c)
    // A and B demote each other, so C always finds one of its sources stale.
    vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async function (this: PlanNodeService, ctx) {
      if (ctx.nodeId === a) this.states.upsert(b, "", { status: "OUTDATED" })
      if (ctx.nodeId === b) this.states.upsert(a, "", { status: "OUTDATED" })
      this.states.upsert(ctx.nodeId, "", { status: "GENERATED", content: `gen-${ctx.nodeId}` })
      return this.getRow(ctx.nodeId, "")
    })
    await expect(regenerateTreeNodesContents()).rejects.toThrow(/did not converge/)
  })

  it("starts nothing new once it has given up, though another node is ready", async () => {
    // The same pair, and E, ready from the start but always behind them in
    // the graph's order: with one call at a time it never gets its turn.
    const a = seedNode({ title: "A", settings: PROMPT, at: { "": "OUTDATED" } })
    const b = seedNode({ title: "B", settings: PROMPT, at: { "": "OUTDATED" } })
    const e = seedNode({ title: "E", settings: PROMPT, at: { "": "OUTDATED" } })
    const started: number[] = []
    vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async function (this: PlanNodeService, ctx) {
      started.push(ctx.nodeId)
      if (ctx.nodeId === a) this.states.upsert(b, "", { status: "OUTDATED" })
      if (ctx.nodeId === b) this.states.upsert(a, "", { status: "OUTDATED" })
      this.states.upsert(ctx.nodeId, "", { status: "GENERATED", content: `gen-${ctx.nodeId}` })
      return this.getRow(ctx.nodeId, "")
    })

    await expect(regenerateTreeNodesContents()).rejects.toThrow(/did not converge/)

    expect(started).not.toContain(e)
  })
})
