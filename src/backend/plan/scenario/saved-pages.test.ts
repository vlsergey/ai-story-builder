import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tearDownTestDb } from "../../db/test-db-utils.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import { PlanScenario } from "./plan-scenario.js"

vi.mock("../../ai/ai-engine-adapter.js", async () => (await import("./fake-engine.js")).fakeEngineAdapterModule)

describe("a page saved next to the project", () => {
  let folder: string
  let projectFile: string
  const saved = () => readdirSync(folder).filter((name) => name.endsWith(".html"))
  const read = (name: string) => readFileSync(path.join(folder, name), "utf8")

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), "saved-pages-"))
    projectFile = path.join(folder, "Брат и сестра.sqlite")
  })
  afterEach(() => {
    tearDownTestDb()
    rmSync(folder, { recursive: true, force: true })
  })

  /** A text laid out as a page, with the page's file settings as given. */
  const page = (settings: { saveNextToProject?: boolean; fileName?: string }) =>
    PlanScenario.build(
      (g) => {
        g.source("Текст", "Аня вышла на балкон.")
        g.format("Вёрстка плана", "<p>{{[Текст]}}</p>", ["Текст"], settings)
      },
      { projectFile },
    )

  it("is written under the masked name, named after the project file", async () => {
    const s = page({ saveNextToProject: true, fileName: "{{projectFile}} (план).html" })
    SettingsRepository.setProjectTitle("Без названия")

    await s.run()

    expect(saved()).toEqual(["Брат и сестра (план).html"])
    expect(read("Брат и сестра (план).html")).toBe("<p>Аня вышла на балкон.</p>")
  })

  it("is written again when the page is rebuilt", async () => {
    const s = page({ saveNextToProject: true, fileName: "{{projectFile}}.html" })
    await s.run()

    await s.type("Текст", "Дверь захлопнулась.")
    await s.run()

    expect(read("Брат и сестра.html")).toBe("<p>Дверь захлопнулась.</p>")
  })

  it("is not written while saving is off", async () => {
    const s = page({ fileName: "{{projectFile}}.html" })

    await s.run()

    expect(saved()).toEqual([])
  })

  it("is not written from inside a loop: every iteration would overwrite it", async () => {
    const s = PlanScenario.build(
      (g) => {
        g.source("Синопсис", "Две главы.")
        g.split("Главы", { prompt: "Главы:\n{{[Синопсис]}}" })
        g.loop("Цикл по главам", { over: "Главы", element: "Глава", result: "Выход главы" }, (b) => {
          b.format("Страница главы", "<p>{{[Глава]}}</p>", ["Глава"], {
            saveNextToProject: true,
            fileName: "{{title}}.html",
          })
          b.result("Страница главы")
        })
      },
      { projectFile },
    )
    s.engine.on((call) => (call.node === "Главы" ? JSON.stringify({ parts: ["Первая", "Вторая"] }) : undefined))

    await s.run()

    expect(s.loopResults("Цикл по главам")).toEqual(["<p>Первая</p>", "<p>Вторая</p>"])
    expect(saved()).toEqual([])
  })
})
