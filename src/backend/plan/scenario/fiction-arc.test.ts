import { afterEach, describe, expect, it, vi } from "vitest"
import { tearDownTestDb } from "../../db/test-db-utils.js"
import { PlanScenario } from "./plan-scenario.js"

vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)

/** The shipped template, end to end, with the fake model: splits give two parts, reviews find nothing. */
const WIZARD = {
  ageRating: "18+",
  synopsis: "Брат выставляет сестру на балкон в одном полотенце и запирает дверь.",
  chunksCount: 2,
}

const fictionArc = () => PlanScenario.fromTemplate("fiction-arc.ru.json", WIZARD)

describe("the fiction-arc template", () => {
  afterEach(() => tearDownTestDb())

  it("runs end to end and leaves nothing broken or pending", async () => {
    const s = await fictionArc()

    await s.run()

    expect(s.calls().length).toBeGreaterThan(20)
    const unsettled = s.nodes().filter((n) => ["ERROR", "OUTDATED", "GENERATING"].includes(n.status))
    expect(unsettled).toEqual([])
  })

  it("asks the model nothing on a second run", async () => {
    const s = await fictionArc()
    await s.run()

    await s.run()

    expect(s.calls()).toEqual([])
  })

  it("re-runs nothing that an edited style cannot reach", async () => {
    const s = await fictionArc()
    await s.run()

    await s.type("Стиль", "Короткие фразы, без канцелярита.")
    await s.run()

    const reachable = s.reachableFrom("Стиль")
    expect(s.generated().filter((title) => !reachable.has(title))).toEqual([])
    expect(s.generated().length).toBeGreaterThan(0)
  })

  // Fixed by the iteration-state rework: a change from outside a loop reaches
  // only the iteration mounted in the rows.
  it.fails("re-writes every character's profile after the style changes", async () => {
    const s = await fictionArc()
    await s.run()

    await s.type("Стиль", "Короткие фразы, без канцелярита.")
    await s.run()

    expect(s.calls("text").filter((c) => c.node === "Профиль персонажа")).toHaveLength(2)
  })
})
