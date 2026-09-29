import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { PlanNodeService } from "./plan-node-service.js"

/** Word, char and byte counts, which the graph shows on every node. */
describe("node counts", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  const counts = (id: number) => {
    const row = new PlanNodeRepository().findById(id)!
    return { words: row.word_count, chars: row.char_count, bytes: row.byte_count }
  }

  it("follow every content change, not only the first", async () => {
    const service = new PlanNodeService()
    const { id } = service.create({ title: "Сцена", type: "text", content: "раз два" })

    await service.patch(id, true, { content: "раз два три" })

    expect(counts(id)).toEqual({ words: 3, chars: 11, bytes: 20 })
  })

  it("drop to zero when the content is cleared", async () => {
    const service = new PlanNodeService()
    const { id } = service.create({ title: "Сцена", type: "text", content: "раз два" })

    await service.patch(id, true, { content: "" })

    expect(counts(id)).toEqual({ words: 0, chars: 0, bytes: 0 })
  })

  it("measure a split's parts, not its JSON", async () => {
    const service = new PlanNodeService()
    const { id } = service.create({ title: "Части", type: "split" })

    await service.patch(id, false, { content: JSON.stringify(["one two", "three"]) })

    expect(counts(id).words).toBe(3)
  })

  it("measure fix-problems' final text, not its envelope", async () => {
    const service = new PlanNodeService()
    const { id } = service.create({ title: "Мир", type: "fix-problems" })
    const envelope = {
      iterations: [
        { input: "draft text", findProblemsResult: { foundProblems: [] }, fixProblemsResult: "one two three four" },
      ],
    }

    await service.patch(id, false, { content: JSON.stringify(envelope) })

    expect(counts(id).words).toBe(4)
  })
})
