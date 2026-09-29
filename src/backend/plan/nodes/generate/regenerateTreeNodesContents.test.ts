import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { seedEdge, seedNode } from "../plan-node-fixtures.js"
import { PlanNodeService } from "../plan-node-service.js"
import { regenerateSubtreeNodesContents } from "./regenerateTreeNodesContents.js"

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
    const abortController = new AbortController()
    const context = {
      abortSignal: abortController.signal,
      options: { regenerateManual: false, regenerateGenerated: false },
      path: "",
      onNodeSkip: () => {},
      onNodeStart: async <T>(node: { id: number; path: string }, block: (ctx: any) => Promise<{ result: T }>) =>
        (
          await block({
            nodeId: node.id,
            path: node.path,
            abortSignal: abortController.signal,
            onResponseStreamEvent: () => {},
          })
        ).result,
    }

    await expect(regenerateSubtreeNodesContents(context as any, null)).rejects.toThrow(/did not converge/)
  })
})
