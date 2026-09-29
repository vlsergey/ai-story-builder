import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { PlanNodeService } from "./plan-node-service.js"

/** Dragging several nodes in the graph patches them in one call (the `batchPatch` route). */
describe("PlanNodeService.batchPatch", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  it("has stored every position by the time it returns", async () => {
    const repo = new PlanNodeRepository()
    const a = repo.insert({ title: "A", type: "text" })
    const b = repo.insert({ title: "B", type: "text" })

    await new PlanNodeService().batchPatch([
      { id: a, data: { x: 10, y: 20 } },
      { id: b, data: { x: 30, y: 40 } },
    ])

    expect(repo.findById(a)).toMatchObject({ x: 10, y: 20 })
    expect(repo.findById(b)).toMatchObject({ x: 30, y: 40 })
  })

  it("reports a failure to the caller instead of losing it", async () => {
    const a = new PlanNodeRepository().insert({ title: "A", type: "text" })

    await expect(
      new PlanNodeService().batchPatch([
        { id: a, data: { x: 10 } },
        { id: 999_999, data: { x: 30 } },
      ]),
    ).rejects.toThrow(/not found/)
  })
})
