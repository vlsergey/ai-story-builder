import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectTemplate } from "../../../../shared/project-template.js"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { PlanNodeRepository } from "../../../plan/nodes/plan-node-repository.js"
import { applyProjectTemplate } from "../../../projects/apply-project-template.js"
import { SettingsRepository } from "../../../settings/settings-repository.js"

/**
 * Full-template diagnostic: applies fiction-arc.ru.json into a fresh DB with a
 * stub synopsis and stubbed-out LLM calls, then runs regenerateTreeNodesContents
 * end-to-end. The goal is to see what happens to the Цикл по персонажам node
 * (and its children) after a clean run — in particular, whether iterations
 * actually fire and whether per-character profiles get generated.
 *
 * Each LLM-shape is mocked to return predictable, deterministic output keyed
 * on the calling node's title. The character-split returns exactly 2 chars;
 * the plot-split returns 20 beats.
 */

vi.mock("../../../settings/ai-settings.js", () => ({
  getCurrentEngineDefaultAiGenerationSettings: () => ({ model: "stub", temperature: 0.7 }),
}))

vi.mock("../../../ai/generate-plan-node-text-content.js", () => ({
  generatePlanNodeTextContent: vi.fn(
    async (_signal: AbortSignal, node: { id: number; title: string; parent_id: number | null }) => {
      // Профиль персонажа is the load-bearing case: each for-each iteration
      // must see a different character via the sibling «Персонаж» (for-each-input)
      // and produce a profile that mentions that character. If the for-each is
      // broken and only one iteration fires, both profiles will name the same
      // character — assertions further down will catch that.
      if (node.title === "Профиль персонажа") {
        const { PlanNodeRepository } = await import("../../../plan/nodes/plan-node-repository.js")
        const repo = new PlanNodeRepository()
        const siblings = repo.findByParentId(node.parent_id)
        const personInput = siblings.find((n) => n.title === "Персонаж")
        const rawInput = personInput?.content ?? "<no input>"
        // Input shape after the recent block-format change: "Имя — фраза" OR
        // "Имя, поле: значение, … — фраза". Pull the leading name segment.
        const charName = rawInput.split(/[,—-]/)[0]?.trim() || "<unnamed>"
        return [
          `# ${charName}`,
          ``,
          `## Анкета`,
          `- Возраст: 19`,
          `- Пол: М`,
          ``,
          `## Профиль`,
          `Профиль персонажа ${charName}, развёрнутый из анкеты выше. Вход: ${rawInput}.`,
        ].join("\n")
      }
      return `[stub generated content for "${node.title}"]`
    },
  ),
}))

vi.mock("../../../ai/generate-split-parts.js", () => ({
  generateSplitParts: vi.fn(async (_signal: AbortSignal, node: { title: string }) => {
    if (node.title === "Разбиение списка персонажей") {
      return ["Анна — главная героиня", "Борис — антагонист"]
    }
    if (node.title === "Разбиение плана сюжета") {
      return Array.from({ length: 20 }, (_, i) => `Бит ${i + 1}: тестовый текст бита.`)
    }
    return []
  }),
}))

vi.mock("../../../ai/generate-summary.js", () => ({
  generateSummary: vi.fn(async (_signal: AbortSignal, _keys: string[], content: string) => {
    return `summary: ${content.slice(0, 30)}`
  }),
}))

vi.mock("../../../ai/generate-fix-problems.js", () => ({
  findProblems: vi.fn(async () => ({ foundProblems: [] })),
  fixProblems: vi.fn(async (_signal: AbortSignal, _node: any, source: string) => source),
}))

const TEMPLATE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fiction-arc.ru.json")

describe("fiction-arc end-to-end (stubbed LLM)", () => {
  let template: ProjectTemplate

  beforeEach(async () => {
    setUpTestDb()
    template = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8")) as ProjectTemplate
    SettingsRepository.setCurrentBackend("grok")
    SettingsRepository.setAllAiEnginesConfig({
      grok: {
        api_key: "fake-key",
        defaultAiGenerationSettings: { model: "stub" },
      },
    })
  })

  afterEach(() => {
    tearDownTestDb()
    vi.clearAllMocks()
  })

  it("regenerates the whole template; Цикл по персонажам runs 2 iterations and outputs 2 profiles", async () => {
    applyProjectTemplate(template, { synopsis: "Тестовый синопсис: Анна и Борис в маленьком городе." })

    const { regenerateTreeNodesContents } = await import("../../../plan/nodes/generate/regenerateTreeNodesContents.js")
    await regenerateTreeNodesContents()

    const planRepo = new PlanNodeRepository()
    const nodes = planRepo.findAll()
    const byTitle = new Map(nodes.map((n) => [n.title, n]))

    const synopsis = byTitle.get("Синопсис")!
    expect(synopsis.status, "Синопсис should not be regenerated").toBe("MANUAL")
    expect(synopsis.content).toMatch(/Анна и Борис/)

    const splitChars = byTitle.get("Разбиение списка персонажей")!
    const parts = JSON.parse(splitChars.content!) as string[]
    expect(parts).toHaveLength(2)

    const cycle = byTitle.get("Цикл по персонажам")!
    const cycleContent = JSON.parse(cycle.content || "{}") as { length?: number; overrides?: unknown[] }
    // EXPECTED: length=2, two iteration overrides containing the input names.
    // BUG candidate: if onInputContentChange didn't propagate, length will be 0 / undefined.
    expect(cycleContent.length, `Цикл length should be 2, got ${cycleContent.length}`).toBe(2)
    expect(cycle.status).not.toBe("EMPTY")

    // Inspect children of the cast for-each
    const cycleChildren = nodes.filter((n) => n.parent_id === cycle.id)
    const profile = cycleChildren.find((n) => n.title === "Профиль персонажа")
    const review = cycleChildren.find((n) => n.title === "Ревью персонажа")
    const output = cycleChildren.find((n) => n.title === "Выход")
    expect(profile, "Профиль персонажа child must exist").toBeTruthy()
    expect(review, "Ревью персонажа child must exist").toBeTruthy()
    expect(output, "Выход child must exist").toBeTruthy()

    // For-each output: should be a textArray of 2 polished profiles
    const cycleOutputContent = JSON.parse(cycle.content || "{}") as {
      currentIndex?: number
      overrides?: Array<Record<string, { content?: string }>>
    }
    const outputs = (cycleOutputContent.overrides || []).map((override, idx) => {
      const outNodeOverride = output ? override?.[`${output.id}`] : null
      if (idx === (cycleOutputContent.currentIndex ?? 0)) {
        return output?.content || outNodeOverride?.content || ""
      }
      return outNodeOverride?.content || ""
    })

    console.log("--- DIAGNOSTIC OUTPUT ---")
    console.log("Cycle content:", JSON.stringify(cycleContent, null, 2))
    console.log(
      "Children of cycle:",
      cycleChildren.map((c) => ({ title: c.title, status: c.status, content: c.content?.slice(0, 80) })),
    )
    console.log("Per-iteration outputs:", outputs)
    console.log("--- END DIAGNOSTIC ---")

    // Cast bible merge — should contain content from both iterations
    const castBible = byTitle.get("Сводка по персонажам")
    expect(castBible, "Сводка по персонажам must exist").toBeTruthy()
    expect(castBible?.status).not.toBe("EMPTY")
    expect(castBible?.content || "", "Cast bible must be non-empty").not.toBe("")

    // The crucial check: 2 iterations should produce 2 outputs
    expect(outputs.filter((o) => o.length > 0).length, "Expected 2 non-empty per-iteration outputs").toBe(2)

    // Per-character expansion check: each iteration's profile must name its OWN
    // character. If the for-each is broken (only first iteration fires, or all
    // iterations share state), both profiles will name the same person.
    const castBibleText = castBible?.content || ""
    console.log("--- CAST BIBLE ---")
    console.log(castBibleText)
    console.log("--- END CAST BIBLE ---")

    expect(castBibleText, "Cast bible must mention Анна").toMatch(/Анна/)
    expect(castBibleText, "Cast bible must mention Борис").toMatch(/Борис/)

    // Also: every iteration's profile must be DISTINCT (not the same stub
    // copy-pasted). Compare the two outputs directly.
    const [firstOut, secondOut] = outputs
    expect(firstOut, "Iteration 0 output must be non-empty").not.toBe("")
    expect(secondOut, "Iteration 1 output must be non-empty").not.toBe("")
    expect(
      firstOut,
      "Iteration outputs must differ — same content for both iterations means for-each did not iterate per character",
    ).not.toBe(secondOut)
  })
})
