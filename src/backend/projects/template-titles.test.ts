import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectTemplate } from "../../shared/project-template.js"
import { setUpTestDb, tearDownTestDb } from "../db/test-db-utils.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { applyProjectTemplate } from "./apply-project-template.js"
import { exportProjectAsTemplate } from "./export-project-as-template.js"

vi.mock("../settings/settings-repository.js", () => ({
  SettingsRepository: {
    getProjectTitle: () => "Test Project",
  },
}))

describe("project template title-based references", () => {
  let tempFile: string

  beforeEach(() => {
    setUpTestDb()
    tempFile = path.join(os.tmpdir(), `template-titles-${Date.now()}-${Math.random()}.json`)
  })

  afterEach(async () => {
    tearDownTestDb()
    try {
      await fs.unlink(tempFile)
    } catch {
      // ignore
    }
  })

  it("exports edges with sourceNodeTitle (no IDs)", async () => {
    const planRepo = new PlanNodeRepository()
    const edgeRepo = new PlanEdgeRepository()
    const aId = planRepo.insert({ title: "A", type: "text", x: 0, y: 0 })
    const bId = planRepo.insert({ title: "B", type: "text", x: 0, y: 0 })
    edgeRepo.insert({ from_node_id: aId, to_node_id: bId, type: "text" })

    await exportProjectAsTemplate({ filePath: tempFile, exportLoreStructure: false })

    const written = JSON.parse(await fs.readFile(tempFile, "utf8")) as ProjectTemplate
    const serialized = JSON.stringify(written)
    expect(serialized).not.toMatch(/"id"\s*:/)
    expect(serialized).not.toMatch(/sourceNodeId/)

    const b = written.plan.nodes.find((n) => n.title === "B")!
    expect(b.inputs).toEqual([{ sourceNodeTitle: "A", type: "text" }])
  })

  it("round-trips a graph with edges via titles", async () => {
    const planRepo = new PlanNodeRepository()
    const edgeRepo = new PlanEdgeRepository()
    const aId = planRepo.insert({ title: "A", type: "text", x: 0, y: 0 })
    const bId = planRepo.insert({ title: "B", type: "text", x: 0, y: 0 })
    const cId = planRepo.insert({ title: "C", type: "text", x: 0, y: 0 })
    edgeRepo.insert({ from_node_id: aId, to_node_id: bId, type: "text" })
    edgeRepo.insert({ from_node_id: aId, to_node_id: cId, type: "text" })
    edgeRepo.insert({ from_node_id: bId, to_node_id: cId, type: "text" })

    await exportProjectAsTemplate({ filePath: tempFile, exportLoreStructure: false })
    const written = JSON.parse(await fs.readFile(tempFile, "utf8")) as ProjectTemplate

    tearDownTestDb()
    setUpTestDb()
    applyProjectTemplate(written, {})

    const newNodes = new PlanNodeRepository().findAll()
    const newEdges = new PlanEdgeRepository().findAll()
    const byTitle = new Map(newNodes.map((n) => [n.title, n]))

    expect(byTitle.size).toBe(3)
    const a = byTitle.get("A")!
    const b = byTitle.get("B")!
    const c = byTitle.get("C")!

    const edgeKeys = newEdges.map((e) => `${byTitle.get(newNodes.find((n) => n.id === e.from_node_id)!.title)!.title}->${byTitle.get(newNodes.find((n) => n.id === e.to_node_id)!.title)!.title}`)
    expect(edgeKeys.sort()).toEqual(["A->B", "A->C", "B->C"])
    expect(a.id).not.toBe(b.id)
  })

  it("round-trips fix-problems sourceNodeTitleToFix into runtime sourceNodeIdToFix", async () => {
    const planRepo = new PlanNodeRepository()
    const edgeRepo = new PlanEdgeRepository()
    const srcId = planRepo.insert({ title: "Draft", type: "text", x: 0, y: 0 })
    const fixId = planRepo.insert({
      title: "Fixed",
      type: "fix-problems",
      x: 0,
      y: 0,
      node_type_settings: JSON.stringify({ sourceNodeIdToFix: srcId, maxIterations: 3 }),
    })
    edgeRepo.insert({ from_node_id: srcId, to_node_id: fixId, type: "text" })

    await exportProjectAsTemplate({ filePath: tempFile, exportLoreStructure: false })
    const written = JSON.parse(await fs.readFile(tempFile, "utf8")) as ProjectTemplate
    const fixedInTpl = written.plan.nodes.find((n) => n.title === "Fixed")!
    expect(fixedInTpl.nodeTypeSettings).toEqual({ sourceNodeTitleToFix: "Draft", maxIterations: 3 })

    tearDownTestDb()
    setUpTestDb()
    applyProjectTemplate(written, {})

    const newNodes = new PlanNodeRepository().findAll()
    const newDraft = newNodes.find((n) => n.title === "Draft")!
    const newFix = newNodes.find((n) => n.title === "Fixed")!
    const runtimeSettings = JSON.parse(newFix.node_type_settings!)
    expect(runtimeSettings).toEqual({ sourceNodeIdToFix: newDraft.id, maxIterations: 3 })
  })

  it("rejects export when two plan siblings share a title", async () => {
    const planRepo = new PlanNodeRepository()
    planRepo.insert({ title: "Dup", type: "text", x: 0, y: 0 })
    planRepo.insert({ title: "Dup", type: "text", x: 0, y: 0 })

    await expect(exportProjectAsTemplate({ filePath: tempFile, exportLoreStructure: false })).rejects.toThrow(/Dup/)
  })

  it("rejects apply when template has duplicate sibling titles", () => {
    const template: ProjectTemplate = {
      label: "Tpl",
      description: "",
      plan: {
        nodes: [
          { title: "X", type: "text" },
          { title: "X", type: "text" },
        ],
      },
    }
    expect(() => applyProjectTemplate(template, {})).toThrow(/"X"/)
  })

  it("rejects apply when an input references a missing sibling title", () => {
    const template: ProjectTemplate = {
      label: "Tpl",
      description: "",
      plan: {
        nodes: [
          { title: "A", type: "text" },
          {
            title: "B",
            type: "text",
            inputs: [{ sourceNodeTitle: "Nonexistent", type: "text" }],
          },
        ],
      },
    }
    expect(() => applyProjectTemplate(template, {})).toThrow(/Nonexistent/)
  })
})
