import { afterEach, beforeEach, describe, expect, it } from "vitest"
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

  it("returns 1-based index from the enclosing for-each currentIndex", () => {
    const service = new PlanNodeService()
    const fe = service.create({
      type: "for-each",
      title: "FE",
      content: JSON.stringify({ currentIndex: 4, length: 10, overrides: [] }),
    })
    const idx = service.create({
      type: "for-each-index",
      title: "Index",
      parent_id: fe.id,
    })

    const out = new ForEachIndexProcessor().getOutput(service, service.getById(idx.id))
    expect(out).toBe("5")
  })

  it("defaults to '1' when the for-each has no content yet", () => {
    const service = new PlanNodeService()
    const fe = service.create({ type: "for-each", title: "FE" })
    const idx = service.create({ type: "for-each-index", title: "Index", parent_id: fe.id })

    const out = new ForEachIndexProcessor().getOutput(service, service.getById(idx.id))
    expect(out).toBe("1")
  })

  it("returns '1' when content is malformed JSON", () => {
    const service = new PlanNodeService()
    const fe = service.create({ type: "for-each", title: "FE" })
    // Overwrite the for-each content with garbage to exercise the catch branch.
    service.repo.patch(fe.id, { content: "{not-valid" })
    const idx = service.create({ type: "for-each-index", title: "Index", parent_id: fe.id })

    const out = new ForEachIndexProcessor().getOutput(service, service.getById(idx.id))
    expect(out).toBe("1")
  })

  it("returns empty string when not nested in any for-each", () => {
    const service = new PlanNodeService()
    // Insert via repo to bypass the service-side validation that for-each-index
    // is allowed only inside a for-each — exercises defensive runtime behavior.
    const id = service.repo.insert({
      type: "for-each-index",
      title: "Orphan Index",
      x: 0,
      y: 0,
    })

    const out = new ForEachIndexProcessor().getOutput(service, service.getById(id))
    expect(out).toBe("")
  })
})
