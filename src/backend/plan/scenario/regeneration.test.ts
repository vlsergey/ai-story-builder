import { afterEach, describe, expect, it, vi } from "vitest"
import { tearDownTestDb } from "../../db/test-db-utils.js"
import { PlanScenario } from "./plan-scenario.js"

vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)

/** A short chain: a synopsis the user wrote, and four nodes the model writes from it. */
function story(): PlanScenario {
  return PlanScenario.build((g) => {
    g.source("Синопсис", "Брат запирает сестру на балконе.")
    g.text("Мир", { prompt: "Опиши мир по синопсису:\n{{[Синопсис]}}" })
    g.text("Стиль", { prompt: "Сформулируй правила стиля." })
    g.text("План", { prompt: "Составь план по миру и синопсису:\n{{[Мир]}}\n{{[Синопсис]}}" })
    g.text("Проза", { prompt: "Напиши прозу по плану, в стиле:\n{{[План]}}\n{{[Стиль]}}" })
  })
}

const ranBefore = (order: string[], first: string, second: string) =>
  expect(order.indexOf(first), `${first} before ${second}`).toBeLessThan(order.indexOf(second))

describe("a run", () => {
  afterEach(() => tearDownTestDb())

  it("writes every generated node once, each after the nodes it reads", async () => {
    const s = story()

    await s.run()

    const written = s.generated()
    expect([...written].sort()).toEqual(["Мир", "План", "Проза", "Стиль"])
    expect(s.calls("text")).toHaveLength(4)
    ranBefore(written, "Мир", "План")
    ranBefore(written, "План", "Проза")
    ranBefore(written, "Стиль", "Проза")
    expect(s.status("Синопсис"), "the user's own text is not rewritten").toBe("MANUAL")
  })

  it("over a settled project asks the model nothing", async () => {
    const s = story()
    await s.run()

    await s.run()

    expect(s.calls()).toEqual([])
  })

  it("with «regenerate generated» on, rewrites what the model wrote", async () => {
    const s = story()
    await s.run()
    s.setRegenerate({ generated: true })

    await s.run()

    expect([...s.generated()].sort()).toEqual(["Мир", "План", "Проза", "Стиль"])
  })

  it("with only «regenerate manual» on, redoes the user's texts and leaves the model's alone", async () => {
    const s = story()
    await s.run()
    await s.type("Стиль", "Короткие фразы.")
    s.setRegenerate({ manual: true })

    await s.run()

    expect(s.generated()).toContain("Стиль")
    expect(s.generated(), "Мир was written by the model and reads nothing that changed").not.toContain("Мир")
  })

  it("shows every node in the progress panel while it is being written", async () => {
    const s = story()

    await s.run()

    expect([...s.shownInProgress()].sort()).toEqual(expect.arrayContaining(["Мир", "План", "Проза", "Стиль"]))
  })

  it("that fails reports the failing node's error, and leaves that node in ERROR", async () => {
    const s = story()
    s.engine.on((call) => {
      if (call.node === "План") throw new Error("model is down")
      return undefined
    })

    await expect(s.run()).rejects.toThrow("model is down")

    expect(String(s.lastStatus?.firstError)).toContain("model is down")
    expect(s.status("План")).toBe("ERROR")
    expect(s.generated()).not.toContain("Проза")
  })

  it("that is stopped leaves the node it was writing to be redone, not broken", async () => {
    const s = story()
    s.engine.on((call) => {
      if (call.node === "План") s.stop()
      return undefined
    })

    await expect(s.run()).rejects.toThrow()

    expect(s.status("План")).toBe("OUTDATED")
    expect(s.generated()).not.toContain("Проза")
  })

  it("shows a broken layout template as ERROR, not as generated text", async () => {
    const s = story()
    s.extend((g) => g.format("Страница", "<h1>{{[Нет такого узла]}}</h1>", ["Проза"]))

    await s.run()

    expect(s.status("Страница")).toBe("ERROR")
  })

  it("counts the words of what a list says, not of how it is stored", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Аня и Боря.")
      g.split("Персонажи", { prompt: "Перечисли персонажей:\n{{[Синопсис]}}" })
    })
    s.engine.on((call) => (call.kind === "split" ? JSON.stringify({ parts: ["Аня, сестра", "Боря"] }) : undefined))

    await s.run()

    expect(s.wordCount("Персонажи")).toBe(3)
  })

  it("takes a split that finds nothing as an answer, and does not ask again", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Никого нет.")
      g.split("Побочные линии", { prompt: "Перечисли побочные линии:\n{{[Синопсис]}}" })
      g.loop("Цикл по линиям", { over: "Побочные линии", element: "Линия", result: "Линия: итог" }, (b) => {
        b.text("Текст линии", { prompt: "Раскрой линию:\n{{[Линия]}}" })
        b.result("Текст линии")
      })
      g.text("Финал", { prompt: "Напиши финал:\n{{[Синопсис]}}" })
    })
    s.engine.on((call) => (call.kind === "split" ? JSON.stringify({ parts: [] }) : undefined))
    await s.run()

    await s.run()

    expect(s.calls()).toEqual([])
  })

  it("runs a long chain whose inputs arrive in the worst order", async () => {
    // Each chapter reads the previous one, and the synopsis reaches the last
    // chapter first: the scheduler has to defer and retry a lot, legitimately.
    const chapters = Array.from({ length: 20 }, (_, i) => `Глава ${i + 1}`)
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Двадцать глав на балконе.")
      chapters.forEach((title, i) => {
        g.text(title, { prompt: i === 0 ? "Начни историю." : `Продолжи:\n{{[${chapters[i - 1]}]}}` })
      })
      for (const title of [...chapters].reverse()) g.connect("Синопсис", title)
    })

    await s.run()

    expect(s.generated()).toEqual(chapters)
  })
})

describe("regenerating one node from its editor", () => {
  afterEach(() => tearDownTestDb())

  it("returns the node, so the editor can show it, and counts it", async () => {
    const s = story()

    const node = await s.regenerate("Мир")

    expect(node.title).toBe("Мир")
    expect(node.content).toBe(s.calls("text")[0].response)
    expect(s.lastStatus?.generatedNew).toBe(1)
  })

  it("reports the node's failure as the run's first error", async () => {
    const s = story()
    s.engine.on(() => {
      throw new Error("model is down")
    })

    await expect(s.regenerate("Мир")).rejects.toThrow("model is down")

    expect(String(s.lastStatus?.firstError)).toContain("model is down")
  })
})
