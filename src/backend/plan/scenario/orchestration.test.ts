import { afterEach, describe, expect, it, vi } from "vitest"
import { tearDownTestDb } from "../../db/test-db-utils.js"
import { type LoopBuilder, PlanScenario } from "./plan-scenario.js"

vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)

/**
 * Makes the calls of the given nodes take a moment. Records the most of them
 * in flight at once, and when each started and ended.
 */
function measure(s: PlanScenario, nodes: string[]) {
  let inFlight = 0
  let peak = 0
  const events: string[] = []
  s.engine.on(async (call) => {
    if (!nodes.includes(call.node)) return undefined
    events.push(`start ${call.node}`)
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 10))
    inFlight--
    events.push(`end ${call.node}`)
    return undefined
  })
  return { peak: () => peak, events }
}

/** Four nodes reading only the synopsis: none waits for another. */
function fourIndependent(): PlanScenario {
  return PlanScenario.build((g) => {
    g.source("Синопсис", "Брат запирает сестру на балконе.")
    g.text("Тема", { prompt: "Тема:\n{{[Синопсис]}}" })
    g.text("Жанр", { prompt: "Жанр:\n{{[Синопсис]}}" })
    g.text("Стиль", { prompt: "Стиль:\n{{[Синопсис]}}" })
    g.text("Мир", { prompt: "Мир:\n{{[Синопсис]}}" })
  })
}

/** A for-each over the chapters `parts`; `body` fills each iteration. */
function chapters(body: (b: LoopBuilder) => void, parts = ["A", "B", "C", "D"]): PlanScenario {
  const s = PlanScenario.build((g) => {
    g.source("Синопсис", "История по главам.")
    g.split("Главы", { prompt: "Главы:\n{{[Синопсис]}}" })
    g.loop("Цикл по главам", { over: "Главы", element: "Глава", result: "Выход главы" }, body)
  })
  s.engine.on((call) => (call.node === "Главы" ? JSON.stringify({ parts }) : undefined))
  return s
}

describe("a run", () => {
  afterEach(() => tearDownTestDb())

  it("writes nodes that do not read each other side by side, as many at once as the engine takes", async () => {
    const s = fourIndependent()
    s.setEngineConcurrency(3)
    const { peak } = measure(s, ["Тема", "Жанр", "Стиль", "Мир"])

    await s.run()

    expect(s.generated()).toEqual(expect.arrayContaining(["Тема", "Жанр", "Стиль", "Мир"]))
    expect(peak()).toBe(3)
  })

  it("writes one node at a time when the engine takes one", async () => {
    const s = fourIndependent()
    s.setEngineConcurrency(1)
    const { peak } = measure(s, ["Тема", "Жанр", "Стиль", "Мир"])

    await s.run()

    expect(peak()).toBe(1)
  })

  it("starts a node only once what it reads is written", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Брат запирает сестру на балконе.")
      g.text("План", { prompt: "План:\n{{[Синопсис]}}" })
      g.text("Проза", { prompt: "Проза по плану:\n{{[План]}}" })
      g.text("Стиль", { prompt: "Стиль:\n{{[Синопсис]}}" })
    })
    s.setEngineConcurrency(3)
    const { events } = measure(s, ["План", "Проза", "Стиль"])

    await s.run()

    expect(events.indexOf("end План")).toBeLessThan(events.indexOf("start Проза"))
    expect(events.indexOf("start Стиль"), "the style does not wait for the plan").toBeLessThan(
      events.indexOf("end План"),
    )
  })

  it("runs the iterations of a loop side by side when none reads the ones before it", async () => {
    const s = chapters((b) => {
      b.text("Текст главы", { prompt: "Напиши главу:\n{{[Глава]}}" })
      b.result("Текст главы")
    })
    s.setEngineConcurrency(4)
    const { peak } = measure(s, ["Текст главы"])

    await s.run()

    expect(s.calls("text").filter((c) => c.node === "Текст главы")).toHaveLength(4)
    expect(peak()).toBe(4)
  })

  it("runs an iteration that reads the ones before it only after them", async () => {
    const s = chapters((b) => {
      b.previousResults("Предыдущие главы")
      b.text("Текст главы", { prompt: "Напиши главу:\n{{[Глава]}}\nДо неё:\n{{[Предыдущие главы]}}" })
      b.result("Текст главы")
    })
    s.setEngineConcurrency(4)
    const { peak } = measure(s, ["Текст главы"])

    await s.run()

    expect(s.calls("text").filter((c) => c.node === "Текст главы")).toHaveLength(4)
    expect(peak()).toBe(1)
  })

  it("runs the nodes of one iteration side by side when they do not read each other", async () => {
    const s = chapters(
      (b) => {
        b.text("Сцена", { prompt: "Сцена главы:\n{{[Глава]}}" })
        b.text("Заметки", { prompt: "Заметки к главе:\n{{[Глава]}}" })
        b.merge("Глава целиком", ["Сцена", "Заметки"])
        b.result("Глава целиком")
      },
      ["A"],
    )
    s.setEngineConcurrency(4)
    const { peak } = measure(s, ["Сцена", "Заметки"])

    await s.run()

    expect(peak()).toBe(2)
  })

  it("keeps to the engine's limit across the whole graph, inside loops and out", async () => {
    const s = chapters((b) => {
      b.text("Текст главы", { prompt: "Напиши главу:\n{{[Глава]}}" })
      b.result("Текст главы")
    })
    s.extend((g) => {
      g.text("Тема", { prompt: "Тема:\n{{[Синопсис]}}" })
      g.text("Стиль", { prompt: "Стиль:\n{{[Синопсис]}}" })
    })
    s.setEngineConcurrency(3)
    const { peak } = measure(s, ["Главы", "Текст главы", "Тема", "Стиль"])

    await s.run()

    expect(peak()).toBe(3)
  })
})
