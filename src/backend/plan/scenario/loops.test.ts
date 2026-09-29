import { afterEach, describe, expect, it, vi } from "vitest"
import { tearDownTestDb } from "../../db/test-db-utils.js"
import type { FakeCall } from "./fake-engine.js"
import { PlanScenario } from "./plan-scenario.js"

vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)

/**
 * `it.fails` marks a bug of today's loops that only the iteration-state rework
 * fixes (per-iteration state instead of snapshots mounted onto shared rows).
 * The scenario states the right behaviour; when the rework lands and it
 * passes, vitest reports it, and `it.fails` becomes `it`.
 */

/** A character loop: each character gets a profile, written in the project's style. */
function characters(names: string[], options: { autoSummary?: boolean } = {}): PlanScenario {
  const s = PlanScenario.build((g) => {
    g.source("Синопсис", "Брат запирает сестру на балконе.")
    g.text("Стиль", { prompt: "Сформулируй правила стиля." })
    g.split("Персонажи", { prompt: "Перечисли персонажей:\n{{[Синопсис]}}" })
    g.loop("Цикл по персонажам", { over: "Персонажи", element: "Персонаж", result: "Выход" }, (b) => {
      b.text("Профиль", { prompt: "Профиль персонажа:\n{{[Персонаж]}}\nСтиль:\n{{[Стиль]}}" })
      b.result("Профиль")
    })
    g.merge("Сводка", ["Цикл по персонажам"])
  }, options)
  let cast = names
  s.engine.on((call) => (call.node === "Персонажи" ? JSON.stringify({ parts: cast }) : undefined))
  // A new synopsis makes the split name a new cast.
  castFor.set(s, (next) => {
    cast = next
  })
  return s
}

const castFor = new WeakMap<PlanScenario, (names: string[]) => void>()

/** The user edits the synopsis so that the character list becomes `names`. */
async function recast(s: PlanScenario, names: string[]): Promise<void> {
  castFor.get(s)?.(names)
  await s.type("Синопсис", `Синопсис с персонажами: ${names.join(", ")}`)
}

const profileCalls = (s: PlanScenario): FakeCall[] => s.calls("text").filter((c) => c.node === "Профиль")

describe("a loop", () => {
  afterEach(() => tearDownTestDb())

  it("writes one profile per element and hands them on in order", async () => {
    const s = characters(["Аня", "Боря"])

    await s.run()

    const calls = profileCalls(s)
    expect(calls).toHaveLength(2)
    expect(calls[0].userPrompt).toContain("Аня")
    expect(calls[1].userPrompt).toContain("Боря")
    expect(s.loopResults("Цикл по персонажам")).toEqual([calls[0].response, calls[1].response])
    expect(s.content("Сводка")).toBe(`${calls[0].response}\n\n${calls[1].response}`)
  })

  it("over a settled project asks the model nothing", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await s.run()

    expect(s.calls()).toEqual([])
  })

  it("that is sequential shows each iteration the results of the earlier ones", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Три сцены на балконе.")
      g.split("Сцены", { prompt: "Раздели на сцены:\n{{[Синопсис]}}" })
      g.loop("Цикл по сценам", { over: "Сцены", element: "Сцена", result: "Итог" }, (b) => {
        b.previousResults("Предыдущие")
        b.merge("Сборка предыдущих", ["Предыдущие"])
        b.text("Проза сцены", { prompt: "Напиши сцену:\n{{[Сцена]}}\nРанее:\n{{[Сборка предыдущих]}}" })
        b.result("Проза сцены")
      })
    })
    s.engine.on((call) => (call.node === "Сцены" ? JSON.stringify({ parts: ["Первая", "Вторая"] }) : undefined))

    await s.run()

    const [first, second] = s.calls("text").filter((c) => c.node === "Проза сцены")
    expect(second.userPrompt).toContain(first.response)
  })

  it("that is sequential re-writes the later iterations when an earlier result changes", async () => {
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "Три сцены на балконе.")
      g.text("Стиль", { prompt: "Сформулируй правила стиля." })
      g.split("Сцены", { prompt: "Раздели на сцены:\n{{[Синопсис]}}" })
      g.loop("Цикл по сценам", { over: "Сцены", element: "Сцена", result: "Итог" }, (b) => {
        b.previousResults("Предыдущие")
        b.merge("Сборка предыдущих", ["Предыдущие"])
        b.text("Проза сцены", {
          prompt: "Напиши сцену:\n{{[Сцена]}}\nРанее:\n{{[Сборка предыдущих]}}\nСтиль:\n{{[Стиль]}}",
        })
        b.result("Проза сцены")
      })
    })
    s.engine.on((call) => (call.node === "Сцены" ? JSON.stringify({ parts: ["Первая", "Вторая"] }) : undefined))
    await s.run()

    // The first scene is re-written; the second must follow, since it reads the first.
    await s.type("Стиль", "Короткие фразы.")
    await s.run()

    const prose = s.calls("text").filter((c) => c.node === "Проза сцены")
    expect(prose).toHaveLength(2)
    expect(prose[1].userPrompt).toContain(prose[0].response)
  })

  it("counts the words of every element, not only the one on display", async () => {
    const s = characters(["Аня Иванова", "Боря"])

    await s.run()

    expect(s.wordCount("Персонаж", 0)).toBe(2)
    expect(s.wordCount("Персонаж", 1)).toBe(1)
  })

  it("nested in another loop writes every scene of every part", async () => {
    const s = nestedParts()

    await s.run()

    const manuscript = s.content("Рукопись") ?? ""
    for (const scene of ["Часть 1, сцена А", "Часть 1, сцена Б", "Часть 2, сцена А", "Часть 2, сцена Б"]) {
      expect(manuscript).toContain(`Текст: ${scene}`)
    }
  })
})

/** Parts, each split into scenes by an inner loop, assembled into a manuscript. */
function nestedParts(): PlanScenario {
  const s = PlanScenario.build((g) => {
    g.source("Синопсис", "Две части по две сцены.")
    g.split("Части", { prompt: "Раздели на части:\n{{[Синопсис]}}" })
    g.loop("Цикл по частям", { over: "Части", element: "Часть", result: "Часть: итог" }, (part) => {
      part.split("Сцены части", { prompt: "Раздели часть на сцены:\n{{[Часть]}}" })
      part.loop("Цикл по сценам", { over: "Сцены части", element: "Сцена", result: "Сцена: итог" }, (scene) => {
        scene.text("Текст сцены", { prompt: "Напиши сцену:\n{{[Сцена]}}" })
        scene.result("Текст сцены")
      })
      part.merge("Текст части", ["Цикл по сценам"])
      part.result("Текст части")
    })
    g.merge("Рукопись", ["Цикл по частям"])
  })
  s.engine.on((call) => {
    if (call.node === "Части") return JSON.stringify({ parts: ["Часть 1", "Часть 2"] })
    if (call.node === "Сцены части") {
      const part = call.userPrompt.includes("Часть 2") ? "Часть 2" : "Часть 1"
      return JSON.stringify({ parts: [`${part}, сцена А`, `${part}, сцена Б`] })
    }
    if (call.node === "Текст сцены") return `Текст: ${call.userPrompt.split("\n").at(-1)}`
    return undefined
  })
  return s
}

describe("a loop, bugs fixed by the iteration-state rework", () => {
  afterEach(() => tearDownTestDb())

  // The loop re-runs the element on display too: propagation's top-down rule
  // demotes the mounted input row whenever the loop is stale.
  it.fails("re-writes only the element that changed", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await recast(s, ["Аня", "Вера"])
    await s.run()

    const calls = profileCalls(s)
    expect(calls).toHaveLength(1)
    expect(calls[0].userPrompt).toContain("Вера")
  })

  it.fails("re-writes every element's profile when a node outside the loop changes", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await s.type("Стиль", "Короткие фразы.")
    await s.run()

    expect(profileCalls(s)).toHaveLength(2)
  })

  it.fails("re-writes a node for every element when its prompt is edited", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await s.setPrompt("Профиль", "Короткий профиль:\n{{[Персонаж]}}")
    await s.run()

    expect(profileCalls(s)).toHaveLength(2)
  })

  it.fails("hands on exactly the remaining elements after its list got shorter", async () => {
    const s = characters(["Аня", "Боря", "Вера"])
    await s.run()
    s.show("Цикл по персонажам", 2)

    await recast(s, ["Аня", "Боря"])
    await s.run()

    expect(s.loopResults("Цикл по персонажам")).toHaveLength(2)
  })

  it.fails("over an empty list hands on nothing", async () => {
    const s = characters([])

    await s.run()

    expect(s.loopResults("Цикл по персонажам")).toEqual([])
  })

  it.fails("does not summarize unchanged elements again when one element changes", async () => {
    const s = characters(["Аня", "Боря"], { autoSummary: true })
    await s.run()

    await recast(s, ["Аня", "Вера"])
    await s.run()

    const elementSummaries = s.calls("summary").filter((c) => c.node === "Персонаж")
    expect(elementSummaries).toHaveLength(1)
  })

  it.fails("keeps a review with the element it was started on", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()
    s.show("Цикл по персонажам", 1)

    await s.startReview("Профиль")
    s.show("Цикл по персонажам", 0)

    expect(s.inReview("Профиль", 0)).toBe(false)
  })

  // Only direct children are snapshotted: the inner loop's rows are shared by
  // every part and hold whichever part ran last.
  it.fails("nested in another loop, shows the scenes of the part on display", async () => {
    const s = nestedParts()

    await s.run()

    const scenes = s.loopResults("Цикл по сценам").join("\n")
    expect(scenes).toContain("Часть 1")
    expect(scenes).not.toContain("Часть 2")
  })
})
