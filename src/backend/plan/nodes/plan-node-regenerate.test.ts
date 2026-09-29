import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PlanNodeRow } from "../../../shared/plan-graph.js"
import { generatePlanNodeTextContent } from "../../ai/generate-plan-node-text-content.js"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import { improvePlanNodeContent } from "../../routes/improve-plan-node-content.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import type { RegenerationNodeContext } from "./generate/RegenerationContext.js"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { PlanNodeService } from "./plan-node-service.js"

vi.mock("../../ai/generate-plan-node-text-content.js", () => ({ generatePlanNodeTextContent: vi.fn() }))
vi.mock("../../routes/improve-plan-node-content.js", () => ({ improvePlanNodeContent: vi.fn() }))

function context(nodeId: number, abortController = new AbortController()): RegenerationNodeContext {
  return {
    abortSignal: abortController.signal,
    nodeId,
    options: { regenerateManual: false, regenerateGenerated: false },
    onNodeUpdated: () => {},
    onResponseStreamEvent: () => {},
    asContainer: () => Promise.reject(new Error("not used")),
    asCycle: () => Promise.reject(new Error("not used")),
  }
}

const repo = () => new PlanNodeRepository()
const row = (id: number) => repo().findById(id) as PlanNodeRow

function textNode(): number {
  return repo().insert({
    title: "Сцена",
    type: "text",
    status: "OUTDATED",
    content: "old",
    node_type_settings: JSON.stringify({ userPrompt: "Напиши сцену" }),
  })
}

describe("PlanNodeService.regenerate", () => {
  beforeEach(() => {
    setUpTestDb()
    SettingsRepository.setAutoGenerateSummary(false)
    vi.resetAllMocks()
  })
  afterEach(() => tearDownTestDb())

  describe("the status it stores", () => {
    it("keeps an ERROR its processor reported", async () => {
      const id = repo().insert({
        title: "Вёрстка",
        type: "format",
        status: "OUTDATED",
        node_type_settings: JSON.stringify({ template: "<h1>{{[Нет такого узла]}}</h1>" }),
      })

      await new PlanNodeService().regenerate(context(id))

      expect(row(id).status).toBe("ERROR")
    })

    it("stores an empty list as EMPTY, not as output", async () => {
      const id = repo().insert({
        title: "Разбиение",
        type: "split",
        status: "OUTDATED",
        node_type_settings: JSON.stringify({ userPrompt: "Раздели" }),
      })

      await new PlanNodeService().regenerate(context(id))

      expect(row(id).content).toBe("[]")
      expect(row(id).status).toBe("EMPTY")
    })

    it("ends a node stopped mid-generation OUTDATED, not ERROR", async () => {
      const id = textNode()
      const abortController = new AbortController()
      vi.mocked(generatePlanNodeTextContent).mockImplementation(async () => {
        abortController.abort()
        throw new Error("This operation was aborted")
      })

      await expect(new PlanNodeService().regenerate(context(id, abortController))).rejects.toThrow("aborted")

      expect(row(id).status).toBe("OUTDATED")
    })
  })

  describe("a row that changed while it was generated", () => {
    it("drops the result when the prompt was edited meanwhile", async () => {
      const id = textNode()
      vi.mocked(generatePlanNodeTextContent).mockImplementation(async () => {
        await new PlanNodeService().patch(id, true, { node_type_settings: JSON.stringify({ userPrompt: "Новый" }) })
        return "from the old prompt"
      })

      await new PlanNodeService().regenerate(context(id))

      expect(row(id).content).toBe("old")
      expect(row(id).status).toBe("OUTDATED")
    })

    it("keeps the text the user typed meanwhile", async () => {
      const id = textNode()
      vi.mocked(generatePlanNodeTextContent).mockImplementation(async () => {
        await new PlanNodeService().patch(id, true, { content: "typed by the user" })
        return "generated"
      })

      await new PlanNodeService().regenerate(context(id))

      expect(row(id).content).toBe("typed by the user")
      expect(row(id).status).toBe("MANUAL")
    })

    it("still reports a failure, but leaves the user's text and status alone", async () => {
      const id = textNode()
      vi.mocked(generatePlanNodeTextContent).mockImplementation(async () => {
        await new PlanNodeService().patch(id, true, { content: "typed by the user" })
        throw new Error("model is down")
      })

      await expect(new PlanNodeService().regenerate(context(id))).rejects.toThrow("model is down")

      expect(row(id).status).toBe("MANUAL")
    })
  })
})

describe("PlanNodeService.aiImprove", () => {
  beforeEach(() => {
    setUpTestDb()
    vi.resetAllMocks()
  })
  afterEach(() => tearDownTestDb())

  function runImprove(id: number): Promise<{ error?: unknown }> {
    return new Promise((resolve) => {
      new PlanNodeService().aiImprove(id).subscribe({
        next: () => {},
        error: (error) => resolve({ error }),
        complete: () => resolve({}),
      })
    })
  }

  it("does not overwrite text the user changed while the improve ran", async () => {
    const id = textNode()
    vi.mocked(improvePlanNodeContent).mockImplementation(async (_signal, nodeId) => {
      const oldNode = row(nodeId)
      await new PlanNodeService().patch(nodeId, true, { content: "typed meanwhile" })
      return { oldNode, newContent: "improved" }
    })

    const { error } = await runImprove(id)

    expect(row(id).content).toBe("typed meanwhile")
    expect(String(error)).toMatch(/changed while/)
  })

  it("applies the improvement when nothing changed meanwhile", async () => {
    const id = textNode()
    vi.mocked(improvePlanNodeContent).mockImplementation(async (_signal, nodeId) => ({
      oldNode: row(nodeId),
      newContent: "improved",
    }))

    const { error } = await runImprove(id)

    expect(error).toBeUndefined()
    expect(row(id).content).toBe("improved")
    expect(row(id).in_review).toBe(1)
  })
})
