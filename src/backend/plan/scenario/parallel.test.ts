import { createHash } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { tearDownTestDb } from "../../db/test-db-utils.js"
import { PlanNodeStateRepository } from "../nodes/plan-node-state-repository.js"
import type { FakeCall } from "./fake-engine.js"
import { PlanScenario } from "./plan-scenario.js"

vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)

/**
 * A character loop that runs its elements side by side: each character gets a
 * profile, written in the project's style.
 */
function characters(names: string[], options: { concurrency?: number } = {}): PlanScenario {
  const s = PlanScenario.build((g) => {
    g.source("Синопсис", "Брат запирает сестру на балконе.")
    g.text("Стиль", { prompt: "Сформулируй правила стиля." })
    g.split("Персонажи", { prompt: "Перечисли персонажей:\n{{[Синопсис]}}" })
    g.parallel(
      "Персонажи параллельно",
      { over: "Персонажи", element: "Персонаж", result: "Выход", concurrency: options.concurrency },
      (b) => {
        b.text("Профиль", { prompt: "Профиль персонажа:\n{{[Персонаж]}}\nСтиль:\n{{[Стиль]}}" })
        b.result("Профиль")
      },
    )
    g.merge("Сводка", ["Персонажи параллельно"])
  })
  let cast = names
  s.engine.on((call) => (call.node === "Персонажи" ? JSON.stringify({ parts: cast }) : undefined))
  recastFor.set(s, (next) => {
    cast = next
  })
  return s
}

const recastFor = new WeakMap<PlanScenario, (names: string[]) => void>()

/** The user edits the synopsis so that the character list becomes `names`. */
async function recast(s: PlanScenario, names: string[]): Promise<void> {
  recastFor.get(s)?.(names)
  await s.type("Синопсис", `Синопсис с персонажами: ${names.join(", ")}`)
}

const profileCalls = (s: PlanScenario): FakeCall[] => s.calls("text").filter((c) => c.node === "Профиль")

/** Makes profile calls take a moment, and records how many were in flight at once. */
function measureOverlap(s: PlanScenario): () => number {
  let inFlight = 0
  let peak = 0
  s.engine.on(async (call) => {
    if (call.node !== "Профиль") return undefined
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 10))
    inFlight--
    return undefined
  })
  return () => peak
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

/** Two different names whose hashes share their first six characters: one key, until it grows. */
function namesSharingAKey(): [string, string] {
  const seen = new Map<string, string>()
  for (let i = 0; ; i++) {
    const name = `Персонаж ${i}`
    const key = sha256(name).slice(0, 6)
    const other = seen.get(key)
    if (other !== undefined) return [other, name]
    seen.set(key, name)
  }
}

describe("a parallel loop", () => {
  afterEach(() => tearDownTestDb())

  it("writes one profile per element and hands them on in list order", async () => {
    const s = characters(["Аня", "Боря", "Вера"])

    await s.run()

    const byName = (name: string) => profileCalls(s).find((c) => c.userPrompt.includes(name))?.response
    expect(profileCalls(s)).toHaveLength(3)
    expect(s.loopResults("Персонажи параллельно")).toEqual([byName("Аня"), byName("Боря"), byName("Вера")])
  })

  it("writes an element listed twice once, and hands its profile on at both places", async () => {
    const s = characters(["Аня", "Боря", "Аня"])

    await s.run()

    expect(profileCalls(s)).toHaveLength(2)
    const [first, , third] = s.loopResults("Персонажи параллельно")
    expect(third).toBe(first)
  })

  it("writes elements side by side, as many at once as the engine takes", async () => {
    const s = characters(["Аня", "Боря", "Вера", "Гоша", "Даня"])
    s.setEngineConcurrency(2)
    const peak = measureOverlap(s)

    await s.run()

    expect(profileCalls(s)).toHaveLength(5)
    expect(peak()).toBe(2)
  })

  it("writes no more elements at once than the loop allows", async () => {
    const s = characters(["Аня", "Боря", "Вера", "Гоша"], { concurrency: 1 })
    const peak = measureOverlap(s)

    await s.run()

    expect(peak()).toBe(1)
  })

  it("over a settled project asks the model nothing", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await s.run()

    expect(s.calls()).toEqual([])
  })

  it("re-writes only the element that changed", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await recast(s, ["Аня", "Вера"])
    await s.run()

    expect(profileCalls(s).map((c) => c.userPrompt.includes("Вера"))).toEqual([true])
    expect(s.loopResults("Персонажи параллельно")).toHaveLength(2)
  })

  it("keeps every profile when an element is inserted before them", async () => {
    const s = characters(["Боря", "Вера"])
    await s.run()
    const [borya, vera] = s.loopResults("Персонажи параллельно")

    await recast(s, ["Аня", "Боря", "Вера"])
    await s.run()

    expect(profileCalls(s)).toHaveLength(1)
    expect(s.loopResults("Персонажи параллельно").slice(1)).toEqual([borya, vera])
  })

  it("hands on exactly the remaining elements after its list got shorter", async () => {
    const s = characters(["Аня", "Боря", "Вера"])
    await s.run()

    await recast(s, ["Аня", "Вера"])
    await s.run()

    expect(profileCalls(s)).toEqual([])
    expect(s.loopResults("Персонажи параллельно")).toHaveLength(2)
  })

  it("re-writes every element's profile when a node outside the loop changes", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()

    await s.type("Стиль", "Короткие фразы.")
    await s.run()

    expect(profileCalls(s)).toHaveLength(2)
  })

  it("keeps its results when two elements come to share a key", async () => {
    const [first, second] = namesSharingAKey()
    const s = characters([first])
    await s.run()
    const [kept] = s.loopResults("Персонажи параллельно")

    await recast(s, [first, second])
    await s.run()

    expect(profileCalls(s).map((c) => c.userPrompt.includes(second))).toEqual([true])
    expect(s.loopResults("Персонажи параллельно")[0]).toBe(kept)
  })

  it("that fails finishes the other elements, then reports the failure", async () => {
    const s = characters(["Аня", "Боря", "Вера"])
    s.engine.on((call) => {
      if (call.node === "Профиль" && call.userPrompt.includes("Боря")) throw new Error("model is down")
      return undefined
    })

    await expect(s.run()).rejects.toThrow("model is down")

    expect(s.failure()?.node).toBe("Профиль")
    expect(profileCalls(s).filter((c) => c.response !== undefined)).toHaveLength(2)
  })

  it("that fails starts nothing new anywhere, however deep, once the failure is known", async () => {
    // Two chapters side by side, each writing six scenes one after another.
    const s = PlanScenario.build((g) => {
      g.source("Синопсис", "История.")
      g.split("Главы", { prompt: "Главы:\n{{[Синопсис]}}" })
      g.parallel("Главы параллельно", { over: "Главы", element: "Глава", result: "Выход главы" }, (b) => {
        b.split("Сцены", { prompt: "Сцены главы:\n{{[Глава]}}" })
        b.parallel("Сцены главы", { over: "Сцены", element: "Сцена", result: "Выход сцены", concurrency: 1 }, (c) => {
          c.text("Текст сцены", { prompt: "Напиши сцену:\n{{[Сцена]}}" })
          c.result("Текст сцены")
        })
        b.merge("Глава целиком", ["Сцены главы"])
        b.result("Глава целиком")
      })
    })
    s.engine.on((call) => {
      if (call.node === "Главы") return JSON.stringify({ parts: ["Глава A", "Глава B"] })
      if (call.node !== "Сцены") return undefined
      const chapter = call.userPrompt.includes("Глава A") ? "A" : "B"
      return JSON.stringify({ parts: Array.from({ length: 6 }, (_, i) => `${chapter} сцена ${i}`) })
    })
    let failedAt = Number.POSITIVE_INFINITY
    s.engine.on(async (call) => {
      if (call.node !== "Текст сцены") return undefined
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (call.userPrompt.includes("A сцена 0")) {
        failedAt = s.engine.calls.length
        throw new Error("model is down")
      }
      return undefined
    })

    await expect(s.run()).rejects.toThrow("model is down")

    const startedAfter = s.engine.calls.slice(failedAt).filter((c) => c.node === "Текст сцены")
    expect(startedAfter).toEqual([])
  })

  it("with an unreadable limit of its own, runs at the engine's", async () => {
    const s = characters(["Аня", "Боря", "Вера"], { concurrency: "all" as unknown as number })

    await s.run()

    expect(profileCalls(s)).toHaveLength(3)
  })

  it("keeps its results when a run dies while its keys grow", async () => {
    const [first, second] = namesSharingAKey()
    const s = characters([first])
    await s.run()
    const [kept] = s.loopResults("Персонажи параллельно")
    const rename = vi.spyOn(PlanNodeStateRepository.prototype, "renameIteration").mockImplementationOnce(() => {
      throw new Error("the disk is gone")
    })

    await recast(s, [first, second])
    await s.run().catch(() => {})
    rename.mockRestore()
    await s.run()

    expect(profileCalls(s).map((c) => c.userPrompt.includes(second))).toEqual([true])
    expect(s.loopResults("Персонажи параллельно")[0]).toBe(kept)
  })

  it("tells the progress panel what runs, not what it wrote", async () => {
    const s = characters(["Аня", "Боря"])
    await s.run()
    const texts = profileCalls(s).map((c) => c.response ?? "")

    await s.setPrompt("Профиль", "Короткий профиль:\n{{[Персонаж]}}")
    await s.run()

    const events = JSON.stringify(s.statusEvents)
    for (const text of texts) expect(events).not.toContain(text)
    expect(s.shownInProgress()).toContain("Профиль")
  })

  it("has no memory of earlier iterations: there are none", () => {
    const s = characters(["Аня"])

    expect(() => s.extend((g) => g.inside("Персонажи параллельно").previousResults("Предыдущие"))).toThrow()
  })
})
