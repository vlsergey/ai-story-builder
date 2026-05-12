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

// Avoid touching SettingsRepository's real DB-key wiring during export.
vi.mock("../settings/settings-repository.js", () => ({
  SettingsRepository: {
    getProjectTitle: () => "Test Project",
  },
}))

describe("project template coordinates round-trip", () => {
  let tempFile: string

  beforeEach(async () => {
    setUpTestDb()
    tempFile = path.join(os.tmpdir(), `template-coords-${Date.now()}-${Math.random()}.json`)
  })

  afterEach(async () => {
    tearDownTestDb()
    try {
      await fs.unlink(tempFile)
    } catch {
      // ignore
    }
  })

  it("exports x, y, width and height of plan nodes to the template file", async () => {
    const repo = new PlanNodeRepository()
    repo.insert({ title: "Root", type: "text", x: 100, y: 200, width: 320, height: 180 })
    repo.insert({ title: "Other", type: "text", x: -50, y: 75, width: null, height: null })

    await exportProjectAsTemplate({ filePath: tempFile, exportLoreStructure: false })

    const written = JSON.parse(await fs.readFile(tempFile, "utf8")) as ProjectTemplate
    const [root, other] = written.plan.nodes

    expect(root).toMatchObject({ title: "Root", x: 100, y: 200, width: 320, height: 180 })
    expect(other).toMatchObject({ title: "Other", x: -50, y: 75 })
    expect(other.width).toBeUndefined()
    expect(other.height).toBeUndefined()
  })

  it("imports x, y, width and height from a template into the database", () => {
    const template: ProjectTemplate = {
      label: "Tpl",
      description: "",
      plan: {
        nodes: [
          {
            id: 1,
            title: "A",
            type: "text",
            x: 10,
            y: 20,
            width: 200,
            height: 80,
          },
          {
            id: 2,
            title: "B",
            type: "text",
            x: -30,
            y: 40,
            // width/height omitted on purpose
          },
        ],
      },
    }

    applyProjectTemplate(template, {})

    const nodes = new PlanNodeRepository().findAll()
    const byTitle = new Map(nodes.map((n) => [n.title, n]))

    const a = byTitle.get("A")
    expect(a).toBeDefined()
    expect(a!.x).toBe(10)
    expect(a!.y).toBe(20)
    expect(a!.width).toBe(200)
    expect(a!.height).toBe(80)

    const b = byTitle.get("B")
    expect(b).toBeDefined()
    expect(b!.x).toBe(-30)
    expect(b!.y).toBe(40)
    expect(b!.width).toBeNull()
    expect(b!.height).toBeNull()
  })

  it("round-trips x, y, width and height through export and import", async () => {
    const planRepo = new PlanNodeRepository()
    const edgeRepo = new PlanEdgeRepository()
    const aId = planRepo.insert({ title: "A", type: "text", x: 11, y: 22, width: 100, height: 50 })
    const bId = planRepo.insert({ title: "B", type: "text", x: 33, y: 44, width: null, height: null })
    edgeRepo.insert({ from_node_id: aId, to_node_id: bId, type: "text" })

    await exportProjectAsTemplate({ filePath: tempFile, exportLoreStructure: false })
    const written = JSON.parse(await fs.readFile(tempFile, "utf8")) as ProjectTemplate

    // Start with a clean DB and import the template back
    tearDownTestDb()
    setUpTestDb()

    applyProjectTemplate(written, {})

    const imported = new PlanNodeRepository().findAll()
    const byTitle = new Map(imported.map((n) => [n.title, n]))

    expect(byTitle.get("A")).toMatchObject({ x: 11, y: 22, width: 100, height: 50 })
    expect(byTitle.get("B")).toMatchObject({ x: 33, y: 44, width: null, height: null })
  })
})
