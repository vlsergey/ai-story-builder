import { afterEach, describe, expect, it, vi } from "vitest"
import { tearDownTestDb } from "../../db/test-db-utils.js"
import { PlanScenario } from "./plan-scenario.js"

vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)

/**
 * Синопсис → Мир → План → Проза, with Стиль feeding Проза and an Эпиграф that
 * is wired to Мир but whose prompt does not use it.
 */
async function settledStory(): Promise<PlanScenario> {
  const s = PlanScenario.build((g) => {
    g.source("Синопсис", "Брат запирает сестру на балконе.")
    g.text("Мир", { prompt: "Опиши мир по синопсису:\n{{[Синопсис]}}" })
    g.text("Стиль", { prompt: "Сформулируй правила стиля." })
    g.text("План", { prompt: "Составь план по миру и синопсису:\n{{[Мир]}}\n{{[Синопсис]}}" })
    g.text("Проза", { prompt: "Напиши прозу по плану, в стиле:\n{{[План]}}\n{{[Стиль]}}" })
    g.text("Эпиграф", { prompt: "Придумай эпиграф." })
    g.connect("Мир", "Эпиграф")
  })
  await s.run()
  return s
}

describe("an edit between runs", () => {
  afterEach(() => tearDownTestDb())

  it("re-runs exactly the nodes that read the edited one, directly or through others", async () => {
    const s = await settledStory()

    await s.type("Синопсис", "Сестра запирает брата на балконе.")
    await s.run()

    expect([...s.generated()].sort()).toEqual(["Мир", "План", "Проза"])
  })

  it("does not re-run a node wired to the edited one whose prompt does not use it", async () => {
    const s = await settledStory()

    await s.type("Синопсис", "Сестра запирает брата на балконе.")
    await s.run()

    expect(s.generated()).not.toContain("Эпиграф")
  })

  it("keeps a node the user wrote by hand, even when its input changes", async () => {
    const s = await settledStory()
    await s.type("План", "Мой план.")

    await s.type("Синопсис", "Сестра запирает брата на балконе.")
    await s.run()

    expect(s.content("План")).toBe("Мой план.")
    expect(s.status("План")).toBe("MANUAL")
    expect(s.generated()).not.toContain("План")
  })

  it("re-runs the readers of a node whose text was improved", async () => {
    const s = await settledStory()

    const { error } = await s.improve("План", "Сделай напряжённее.")
    await s.run()

    expect(error).toBeUndefined()
    expect(s.generated()).toContain("Проза")
  })

  it("does not re-run readers when a node is regenerated to the same text", async () => {
    const s = await settledStory()

    await s.regenerate("Мир")
    await s.run()

    expect(s.calls()).toEqual([])
  })

  it("re-runs a review when the text it reviews changes, even if its instructions do not name it", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Брат запирает сестру на балконе.")
      g.text("Черновик мира", { prompt: "Опиши мир:\n{{[Синопсис]}}" })
      g.fixProblems("Мир", { fix: "Черновик мира", find: "Найди ошибки в описании.", fixWith: "Исправь их." })
    })
    await s.run()

    await s.type("Черновик мира", "Балкон на пятом этаже.")
    await s.run()

    expect(s.generated()).toContain("Мир")
  })

  it("does not re-run readers when only a summary is written — prompts never read summaries", async () => {
    const s = await settledStory()

    await s.summarize("План")
    await s.run()

    expect(s.generated()).toEqual([])
  })

  it("keeps the word count in step with the text", async () => {
    const s = await settledStory()

    await s.type("Мир", "Балкон, ветер, двор")

    expect(s.wordCount("Мир")).toBe(3)
  })
})

describe("an edit while the node is being written", () => {
  afterEach(() => tearDownTestDb())

  it("to its prompt discards the result, and the node is written again from the new prompt", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Брат запирает сестру на балконе.")
      g.text("План", { prompt: "Составь план:\n{{[Синопсис]}}" })
      g.text("Проза", { prompt: "Напиши прозу:\n{{[План]}}" })
    })
    let edited = false
    s.engine.on(async (call) => {
      if (call.node === "План" && !edited) {
        edited = true
        await s.setPrompt("План", "Составь подробный план:\n{{[Синопсис]}}")
      }
      return undefined
    })

    await s.run()

    const lastPlanCall = s
      .calls("text")
      .filter((c) => c.node === "План")
      .at(-1)
    expect(lastPlanCall?.userPrompt).toContain("подробный")
    expect(s.content("План")).toBe(lastPlanCall?.response)
  })

  it("to its input discards the result, and the node is written again from the new input", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Брат запирает сестру на балконе.")
      g.text("План", { prompt: "Составь план:\n{{[Синопсис]}}" })
    })
    let edited = false
    s.engine.on(async (call) => {
      if (call.node === "План" && !edited) {
        edited = true
        await s.type("Синопсис", "Сестра запирает брата на балконе.")
      }
      return undefined
    })

    await s.run()

    const lastPlanCall = s
      .calls("text")
      .filter((c) => c.node === "План")
      .at(-1)
    expect(lastPlanCall?.userPrompt).toContain("Сестра запирает брата")
    expect(s.content("План")).toBe(lastPlanCall?.response)
  })

  it("by the user keeps what the user typed, even if the model then fails", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Брат запирает сестру на балконе.")
      g.text("Мир", { prompt: "Опиши мир:\n{{[Синопсис]}}" })
    })
    s.engine.on(async (call) => {
      if (call.node !== "Мир") return undefined
      await s.type("Мир", "Мой мир.")
      throw new Error("model is down")
    })

    await expect(s.run()).rejects.toThrow("model is down")

    expect(s.content("Мир")).toBe("Мой мир.")
    expect(s.status("Мир")).toBe("MANUAL")
  })

  it("by the user keeps what the user typed", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Брат запирает сестру на балконе.")
      g.text("Мир", { prompt: "Опиши мир:\n{{[Синопсис]}}" })
    })
    s.engine.on(async (call) => {
      if (call.node === "Мир") await s.type("Мир", "Мой мир.")
      return undefined
    })

    await s.run()

    expect(s.content("Мир")).toBe("Мой мир.")
    expect(s.status("Мир")).toBe("MANUAL")
  })

  it("discards an improvement whose text changed while it was being written", async () => {
    const s = await settledStory()
    s.engine.on(async (call) => {
      if (call.kind === "improve") await s.type("План", "Правка во время улучшения.")
      return undefined
    })

    const { error } = await s.improve("План", "Сделай напряжённее.")

    expect(s.content("План")).toBe("Правка во время улучшения.")
    expect(String(error)).toMatch(/changed while/)
  })
})
