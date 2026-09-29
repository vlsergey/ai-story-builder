import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { seedEdge, seedNode } from "../plan-node-fixtures.js"
import { PlanNodeService } from "../plan-node-service.js"
import { regenerateTreeNodesContents } from "./regenerateTreeNodesContents.js"

/**
 * Targeted test for the cascade-demotion bug seen on Брат 2:
 *
 * If sibling A regenerates and its patch's downstream-notify cascade demotes
 * sibling B (which was GENERATED at scheduler start) to OUTDATED, the
 * scheduler must NOT then skip B as "already generated" and proceed to
 * process B's downstream C — C would consume B's stale content.
 *
 * The fix re-fetches each node's live status before deciding willRegenerate,
 * and un-checks sources that got demoted mid-flight.
 */

// Mock regenerate at the service level so we can assert ordering without
// actually invoking LLM stuff. Each "regenerate" of a node patches its row
// to GENERATED, and we track the order of calls.
const regenerateOrder: number[] = []

describe("a run re-checks live status after cascades", () => {
  beforeEach(() => {
    setUpTestDb()
    regenerateOrder.length = 0
  })
  afterEach(() => {
    tearDownTestDb()
    vi.restoreAllMocks()
  })

  it("does NOT run downstream after a cascade demotes the upstream mid-flight", async () => {
    // A → B → C linear chain at the top level.
    // A is OUTDATED — scheduler regenerates it. When A is patched, the
    // service fires markAsOutdatedAndNotifyDownstreamNodes(A) which demotes
    // B (and transitively C) to OUTDATED. B was GENERATED before A regen.
    // hasRegenerationCriteria requires text/split/lore nodes to have a
    // non-blank userPrompt, and a consumer is demoted only by inputs its
    // prompt reads.
    const a = seedNode({ title: "A", settings: JSON.stringify({ userPrompt: "stub" }), at: { "": "OUTDATED" } })
    const b = seedNode({
      title: "B",
      settings: JSON.stringify({ userPrompt: "{{[A]}}" }),
      at: { "": { status: "GENERATED", content: "old-B" } },
    })
    const c = seedNode({ title: "C", settings: JSON.stringify({ userPrompt: "{{[B]}}" }), at: { "": "OUTDATED" } })
    seedEdge(a, b)
    seedEdge(b, c)

    // Stub PlanNodeService.regenerate so each call patches the node to
    // GENERATED and records its id.
    vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async function (this: PlanNodeService, ctx) {
      regenerateOrder.push(ctx.nodeId)
      // Mimic real regenerate: patch via the service so downstream-notify fires.
      return await this.patch(ctx.nodeId, ctx.path, false, { status: "GENERATED", content: `gen-${ctx.nodeId}` })
    })

    await regenerateTreeNodesContents()

    // The crucial assertion: B must run BEFORE C, even though B was GENERATED
    // at the moment scheduler snapshotted. A's cascade demoted B, and the
    // scheduler must catch that before letting C proceed.
    const aPos = regenerateOrder.indexOf(a)
    const bPos = regenerateOrder.indexOf(b)
    const cPos = regenerateOrder.indexOf(c)
    expect(aPos, "A must run").toBeGreaterThanOrEqual(0)
    expect(bPos, "B must run (it got demoted by A's cascade)").toBeGreaterThanOrEqual(0)
    expect(cPos, "C must run").toBeGreaterThanOrEqual(0)
    expect(aPos, "A first").toBeLessThan(bPos)
    expect(bPos, "B before C — must not run C against demoted B").toBeLessThan(cPos)
  })

  it("does NOT re-queue an EMPTY source once it's been processed (legitimate empty merge)", async () => {
    // Scenario from Письмо's «Сборка предыдущих сцен»: a merge of an empty
    // textArray legitimately ends a regeneration in status=EMPTY (its single
    // input had no content). With the old re-queue logic, the merge would be
    // misclassified as "still needs regeneration" every time the downstream
    // node tried to consume it, leading to an infinite cycle that gets
    // truncated by the safety counter — and the downstream node never gets
    // regenerated, despite being OUTDATED and having all its sources resolved.
    //
    // Fix: only OUTDATED (and ERROR, debatably) counts as "source got demoted
    // by a cascade mid-flight". EMPTY post-regen is a valid terminal state.
    // empty-source → emptyMerge → consumer.
    // emptyMerge will deterministically regen to EMPTY (no content).
    // consumer is OUTDATED and depends on emptyMerge — must run exactly once.
    const stubSettings = JSON.stringify({ userPrompt: "stub" })
    const src = seedNode({
      title: "Empty source",
      settings: stubSettings,
      at: { "": { status: "GENERATED", content: "" } },
    })
    const merge = seedNode({ title: "Empty merge", type: "merge", at: { "": "OUTDATED" } })
    const consumer = seedNode({ title: "Consumer", settings: stubSettings, at: { "": "OUTDATED" } })
    seedEdge(src, merge)
    seedEdge(merge, consumer)

    // Stub regenerate: merge returns EMPTY (no content), src/consumer return GENERATED with content.
    vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async function (this: PlanNodeService, ctx) {
      regenerateOrder.push(ctx.nodeId)
      const node = this.getRow(ctx.nodeId, ctx.path)
      const patch: { status: "GENERATED" | "EMPTY"; content: string } =
        node.type === "merge" ? { status: "EMPTY", content: "" } : { status: "GENERATED", content: `gen-${ctx.nodeId}` }
      return await this.patch(ctx.nodeId, ctx.path, false, patch)
    })

    await regenerateTreeNodesContents()

    // The consumer MUST have been regenerated despite its source landing in
    // EMPTY status. And the merge must have been regen'd exactly once — no
    // infinite re-queue.
    const mergeRuns = regenerateOrder.filter((id) => id === merge).length
    const consumerRuns = regenerateOrder.filter((id) => id === consumer).length
    expect(mergeRuns, "merge re-queued multiple times — infinite-loop bug").toBe(1)
    expect(consumerRuns, "consumer never ran — deferred forever by demoted-source check").toBe(1)
  })

  it("still reaches a consumer when a settled-EMPTY source stops being empty", async () => {
    // The other half of the forward-EMPTY exemption in propagateStaleStatus.
    // Nothing is pre-marked from a deterministic node that is merely empty —
    // so the run-time cascade has to carry the work instead. Here the merge
    // stops being empty because its own source finally produced something,
    // and the consumer must still be dragged back through regeneration.
    const src = seedNode({ title: "Src", settings: JSON.stringify({ userPrompt: "stub" }), at: { "": "OUTDATED" } })
    const merge = seedNode({ title: "Agg", type: "merge", at: { "": { status: "EMPTY", content: "" } } })
    // The consumer's prompt reads the aggregate, so the aggregate's change demotes it.
    const consumer = seedNode({
      title: "Consumer",
      settings: JSON.stringify({ userPrompt: "{{[Agg]}}" }),
      at: { "": { status: "GENERATED", content: "stale" } },
    })
    seedEdge(src, merge)
    seedEdge(merge, consumer)

    vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async function (this: PlanNodeService, ctx) {
      regenerateOrder.push(ctx.nodeId)
      return await this.patch(ctx.nodeId, ctx.path, false, { status: "GENERATED", content: `gen-${ctx.nodeId}` })
    })

    await regenerateTreeNodesContents()

    expect(regenerateOrder, "merge must re-run — it was EMPTY").toContain(merge)
    expect(regenerateOrder, "consumer must re-run — its source stopped being empty").toContain(consumer)
    expect(regenerateOrder.indexOf(merge)).toBeLessThan(regenerateOrder.indexOf(consumer))
  })

  it("runs again, before its reader, a node demoted after it was done", async () => {
    // X → W and Y → Z, one at a time (no engine is set: the limit is one).
    // X and Y run first; then W, which leaves Y stale the way a cascade from
    // elsewhere would. Z, ready until then, must wait for Y to run again.
    const prompt = (text: string) => JSON.stringify({ userPrompt: text })
    const x = seedNode({ title: "X", settings: prompt("x"), at: { "": "OUTDATED" } })
    const y = seedNode({ title: "Y", settings: prompt("y"), at: { "": "OUTDATED" } })
    const w = seedNode({ title: "W", settings: prompt("{{[X]}}"), at: { "": "OUTDATED" } })
    const z = seedNode({ title: "Z", settings: prompt("{{[Y]}}"), at: { "": "OUTDATED" } })
    seedEdge(x, w)
    seedEdge(y, z)

    let demoted = false
    vi.spyOn(PlanNodeService.prototype, "regenerate").mockImplementation(async function (this: PlanNodeService, ctx) {
      regenerateOrder.push(ctx.nodeId)
      if (ctx.nodeId === w && !demoted) {
        demoted = true
        this.states.upsert(y, "", { status: "OUTDATED" })
      }
      return await this.patch(ctx.nodeId, ctx.path, false, { status: "GENERATED", content: `gen-${ctx.nodeId}` })
    })

    await regenerateTreeNodesContents()

    expect(regenerateOrder).toEqual([x, y, w, y, z])
  })
})
