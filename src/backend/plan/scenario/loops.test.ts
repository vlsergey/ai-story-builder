import { afterEach, describe, expect, it, vi } from "vitest"
import { tearDownTestDb } from "../../db/test-db-utils.js"
import type { FakeCall } from "./fake-engine.js"
import { PlanScenario } from "./plan-scenario.js"

vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)

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

  it("that fails names the element it failed on", async () => {
    const s = characters(["Аня", "Боря"])
    s.engine.on((call) => {
      if (call.node === "Профиль" && call.userPrompt.includes("Боря")) throw new Error("model is down")
      return undefined
    })

    await expect(s.run()).rejects.toThrow("model is down")

    expect(s.failure()).toEqual({ node: "Профиль", iterations: [1] })
    expect(s.status("Профиль", 0)).toBe("GENERATED")
    expect(s.status("Профиль", 1)).toBe("ERROR")
  })

  it("lets the user type into an iteration it reached during its very first run", async () => {
    const s = characters(["Аня", "Боря"])
    s.engine.on(async (call) => {
      if (call.node === "Профиль" && call.userPrompt.includes("Боря")) await s.type("Профиль", "Аня, от руки.")
      return undefined
    })

    await s.run()

    expect(s.content("Профиль", 0)).toBe("Аня, от руки.")
    expect(s.status("Профиль", 0)).toBe("MANUAL")
  })

  it("stopped while its list got shorter, hands on only the remaining elements", async () => {
    const s = characters(["Аня", "Боря", "Вера"])
    await s.run()
    s.engine.on((call) => {
      if (call.node === "Профиль") s.stop()
      return undefined
    })

    await recast(s, ["Вика", "Боря"])
    await s.run().catch(() => {})

    expect(s.loopResults("Цикл по персонажам")).toHaveLength(2)
  })

  it("tries again an element whose profile came back empty", async () => {
    const s = characters(["Аня", "Боря"])
    let empty = true
    s.engine.on((call) => (empty && call.node === "Профиль" && call.userPrompt.includes("Боря") ? "" : undefined))
    await s.run()
    expect(s.status("Профиль", 1)).toBe("EMPTY")

    empty = false
    await s.run()

    expect(profileCalls(s).map((c) => c.userPrompt.includes("Боря"))).toEqual([true])
    expect(s.status("Профиль", 1)).toBe("GENERATED")
    await s.run()
    expect(s.calls()).toEqual([])
  })

  it("with summaries on, summarizes what its iterations wrote, not the loop or an output that did not change", async () => {
    const s = characters(["Аня", "Боря"], { autoSummary: true })
    await s.run()
    expect(s.calls("summary").map((c) => c.node)).not.toContain("Цикл по персонажам")

    await s.setPrompt("Профиль", "Профиль героя:\n{{[Персонаж]}}")
    s.engine.on((call) => (call.node === "Профиль" ? "тот же профиль" : undefined))
    await s.run()
    await s.setPrompt("Профиль", "Профиль героини:\n{{[Персонаж]}}")
    await s.run()

    const summarized = s.calls("summary").map((c) => c.node)
    expect(summarized).not.toContain("Цикл по персонажам")
    expect(summarized, "the output's text did not change").not.toContain("Выход")
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

/**
 * Each iteration keeps its own state. Until the iteration-state rework the
 * iteration on display was mounted onto shared rows and the others kept as
 * snapshots in the loop; each scenario below failed then.
 */
describe("a loop, iteration by iteration", () => {
  afterEach(() => tearDownTestDb())

  it("re-writes only the element that changed", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await recast(s, ["Аня", "Вера"])
    await s.run()

    const calls = profileCalls(s)
    expect(calls).toHaveLength(1)
    expect(calls[0].userPrompt).toContain("Вера")
  })

  it("re-writes every element's profile when a node outside the loop changes", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await s.type("Стиль", "Короткие фразы.")
    await s.run()

    expect(profileCalls(s)).toHaveLength(2)
  })

  it("re-writes a node for every element when its prompt is edited", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await s.setPrompt("Профиль", "Короткий профиль:\n{{[Персонаж]}}")
    await s.run()

    expect(profileCalls(s)).toHaveLength(2)
  })

  it("hands on exactly the remaining elements after its list got shorter", async () => {
    const s = characters(["Аня", "Боря", "Вера"])
    await s.run()
    s.show("Цикл по персонажам", 2)

    await recast(s, ["Аня", "Боря"])
    await s.run()

    expect(s.loopResults("Цикл по персонажам")).toHaveLength(2)
  })

  it("over an empty list hands on nothing", async () => {
    const s = characters([])

    await s.run()

    expect(s.loopResults("Цикл по персонажам")).toEqual([])
  })

  it("does not summarize unchanged elements again when one element changes", async () => {
    const s = characters(["Аня", "Боря"], { autoSummary: true })
    await s.run()

    await recast(s, ["Аня", "Вера"])
    await s.run()

    const elementSummaries = s.calls("summary").filter((c) => c.node === "Персонаж")
    expect(elementSummaries).toHaveLength(1)
  })

  it("keeps a review with the element it was started on", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()
    s.show("Цикл по персонажам", 1)

    await s.startReview("Профиль")
    s.show("Цикл по персонажам", 0)

    expect(s.inReview("Профиль", 0)).toBe(false)
  })

  it("nested in another loop, shows the scenes of the part on display", async () => {
    const s = nestedParts()

    await s.run()

    const scenes = s.loopResults("Цикл по сценам").join("\n")
    expect(scenes).toContain("Часть 1")
    expect(scenes).not.toContain("Часть 2")
  })
})
