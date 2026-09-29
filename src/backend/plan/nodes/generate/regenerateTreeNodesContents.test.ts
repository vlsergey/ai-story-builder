import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan-node-repository.js"
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
    const repo = new PlanNodeRepository()
    const edges = new PlanEdgeRepository()
    const a = repo.insert({ title: "A", type: "text", status: "OUTDATED", node_type_settings: PROMPT })
    const b = repo.insert({ title: "B", type: "text", status: "OUTDATED", node_type_settings: PROMPT })
    const c = repo.insert({ title: "C", type: "text", status: "OUTDATED", node_type_settings: PROMPT })
    edges.insert({ from_node_id: a, to_node_id: c, type: "text" })
    edges.insert({ from_node_id: b, to_node_id: c, type: "text" })
    // A and B demote each other, so C always finds one of its sources stale.
    vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async function (this: PlanNodeService, ctx) {
      if (ctx.nodeId === a) this.repo.patch(b, { status: "OUTDATED" })
      if (ctx.nodeId === b) this.repo.patch(a, { status: "OUTDATED" })
      return this.repo.patch(ctx.nodeId, { status: "GENERATED", content: `gen-${ctx.nodeId}` })
    })
    const abortController = new AbortController()
    const context = {
      abortSignal: abortController.signal,
      options: { regenerateManual: false, regenerateGenerated: false },
      onNodeSkip: () => {},
      onNodeStart: async <T>(node: { id: number }, block: (ctx: any) => Promise<{ result: T }>) =>
        (await block({ nodeId: node.id, abortSignal: abortController.signal, onResponseStreamEvent: () => {} })).result,
    }

    await expect(regenerateSubtreeNodesContents(context as any, null)).rejects.toThrow(/did not converge/)
  })
})
