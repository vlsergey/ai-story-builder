import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RegenerateStatusEvent } from "../../../../shared/RegenerateEvent.js"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { SettingsRepository } from "../../../settings/settings-repository.js"
import { PlanEdgeRepository } from "../../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan-node-repository.js"
import { PlanNodeService } from "../plan-node-service.js"
import {
  regenerateSubtreeNodesContents,
  regenerateTreeNodesContents,
  subscribeToStatusEvents,
} from "./regenerateTreeNodesContents.js"

const PROMPT = JSON.stringify({ userPrompt: "stub" })

/** Stubs regeneration: every node gets `gen-<id>` through a real patch, so cascades still fire. */
function stubRegenerate(ran: number[]) {
  return vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async function (
    this: PlanNodeService,
    ctx,
  ) {
    ran.push(ctx.nodeId)
    return await this.patch(ctx.nodeId, false, { content: `gen-${ctx.nodeId}` })
  })
}

function collectStatusEvents(): RegenerateStatusEvent[] {
  const events: RegenerateStatusEvent[] = []
  const subscription = subscribeToStatusEvents().subscribe({ next: (e) => events.push(e) })
  afterEachCleanups.push(() => subscription.unsubscribe())
  return events
}

const afterEachCleanups: (() => void)[] = []

describe("regenerateTreeNodesContents", () => {
  beforeEach(() => {
    setUpTestDb()
    SettingsRepository.setAutoGenerateSummary(false)
  })
  afterEach(() => {
    for (const cleanup of afterEachCleanups.splice(0)) cleanup()
    tearDownTestDb()
    vi.restoreAllMocks()
  })

  describe("which statuses it regenerates", () => {
    it("regenerates GENERATED nodes when regenerateGenerated is on and regenerateManual is off", async () => {
      const repo = new PlanNodeRepository()
      const a = repo.insert({
        title: "A",
        type: "text",
        status: "GENERATED",
        content: "old",
        node_type_settings: PROMPT,
      })
      SettingsRepository.setAiRegenerateGenerated(true)
      SettingsRepository.setAiRegenerateManual(false)
      const ran: number[] = []
      stubRegenerate(ran)

      await regenerateTreeNodesContents()

      expect(ran).toEqual([a])
    })

    it("leaves GENERATED nodes alone when only regenerateManual is on", async () => {
      const repo = new PlanNodeRepository()
      const generated = repo.insert({
        title: "Generated",
        type: "text",
        status: "GENERATED",
        content: "old",
        node_type_settings: PROMPT,
      })
      const manual = repo.insert({
        title: "Manual",
        type: "text",
        status: "MANUAL",
        content: "typed",
        node_type_settings: PROMPT,
      })
      SettingsRepository.setAiRegenerateGenerated(false)
      SettingsRepository.setAiRegenerateManual(true)
      const ran: number[] = []
      stubRegenerate(ran)

      await regenerateTreeNodesContents()

      expect(ran).toEqual([manual])
      expect(ran).not.toContain(generated)
    })
  })

  describe("a single node", () => {
    it("resolves to the regenerated row, so the editor can show it", async () => {
      const repo = new PlanNodeRepository()
      const a = repo.insert({ title: "A", type: "text", status: "OUTDATED", node_type_settings: PROMPT })
      stubRegenerate([])

      const result = await regenerateTreeNodesContents(a)

      expect(result?.id).toBe(a)
      expect(result?.content).toBe(`gen-${a}`)
    })

    it("counts the node it regenerates", async () => {
      const repo = new PlanNodeRepository()
      const a = repo.insert({ title: "A", type: "text", status: "OUTDATED", node_type_settings: PROMPT })
      stubRegenerate([])
      const events = collectStatusEvents()

      await regenerateTreeNodesContents(a)

      expect(events.at(-1)?.generatedNew).toBe(1)
    })

    it("reports its own failure as the run's first error", async () => {
      const repo = new PlanNodeRepository()
      const a = repo.insert({ title: "A", type: "text", status: "OUTDATED", node_type_settings: PROMPT })
      vi.spyOn(PlanNodeService.prototype, "regenerate").mockRejectedValue(new Error("model is down"))
      const events = collectStatusEvents()

      await expect(regenerateTreeNodesContents(a)).rejects.toThrow("model is down")

      expect(String(events.at(-1)?.firstError)).toContain("model is down")
    })

    it("surfaces the node's error even when the progress stack was left unbalanced", async () => {
      const repo = new PlanNodeRepository()
      const a = repo.insert({ title: "A", type: "text", status: "OUTDATED", node_type_settings: PROMPT })
      vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async (ctx) => {
        await ctx.asCycle(1, async (cycle) => {
          // An iteration that is never awaited stays on the stack when the node fails.
          void cycle.asNode(0, () => new Promise(() => {}))
          throw new Error("the real failure")
        })
        throw new Error("unreachable")
      })

      await expect(regenerateTreeNodesContents(a)).rejects.toThrow("the real failure")
    })
  })

  describe("status events", () => {
    it("keep the progress they had when they were emitted", async () => {
      const repo = new PlanNodeRepository()
      const a = repo.insert({ title: "A", type: "text", status: "OUTDATED", node_type_settings: PROMPT })
      stubRegenerate([])
      const events = collectStatusEvents()

      await regenerateTreeNodesContents()

      const withA = events.filter((e) =>
        e.currentRegenerationStack.some((item) => item.type === "node" && item.node.id === a),
      )
      expect(withA.length, "some event must show A in progress").toBeGreaterThan(0)
    })
  })

  describe("a run that does not converge", () => {
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
          (await block({ nodeId: node.id, abortSignal: abortController.signal, onResponseStreamEvent: () => {} }))
            .result,
      }

      await expect(regenerateSubtreeNodesContents(context as any, null)).rejects.toThrow(/did not converge/)
    })
  })
})
