import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { childPath } from "../../../../shared/plan-node-path.js"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { PlanNodeService } from "../plan-node-service.js"
import { ForEachIndexProcessor } from "./for-each-index-processor.js"

describe("ForEachIndexProcessor", () => {
  beforeEach(() => {
    setUpTestDb()
  })

  afterEach(() => {
    tearDownTestDb()
  })

  it("returns the 1-based position of the iteration it runs in", () => {
    const service = new PlanNodeService()
    const fe = service.create({ type: "for-each", title: "FE" })
    const idx = service.create({ type: "for-each-index", title: "Index", parent_id: fe.id })

    const out = new ForEachIndexProcessor().getOutput(service, service.getRow(idx.id, childPath("", fe.id, 4)))
    expect(out).toBe("5")
  })

  it("returns empty string when not nested in any for-each", () => {
    const service = new PlanNodeService()
    // Insert via repo to bypass the service-side validation that for-each-index
    // is allowed only inside a for-each — exercises defensive runtime behavior.
    const id = service.repo.insert({ type: "for-each-index", title: "Orphan Index", x: 0, y: 0 })

    const out = new ForEachIndexProcessor().getOutput(service, service.getRow(id, ""))
    expect(out).toBe("")
  })

  it("returns empty string at a path that names another loop", () => {
    const service = new PlanNodeService()
    const fe = service.create({ type: "for-each", title: "FE" })
    const other = service.create({ type: "for-each", title: "Other" })
    const idx = service.create({ type: "for-each-index", title: "Index", parent_id: fe.id })

    const out = new ForEachIndexProcessor().getOutput(service, service.getRow(idx.id, childPath("", other.id, 2)))
    expect(out).toBe("")
  })

  it("regenerate returns summary = the index, status = GENERATED — short-circuits the LLM summary call", async () => {
    const service = new PlanNodeService()
    const fe = service.create({ type: "for-each", title: "FE" })
    const idx = service.create({ type: "for-each-index", title: "Index", parent_id: fe.id })

    const patch = await new ForEachIndexProcessor().regenerate(
      service,
      undefined,
      service.getRow(idx.id, childPath("", fe.id, 6)),
    )
    expect(patch.summary, "summary must be present so PlanNodeService.regenerate skips LLM auto-summary").toBe("7")
    expect(patch.status).toBe("GENERATED")
  })
})
