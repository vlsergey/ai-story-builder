import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectTemplate } from "../../../../shared/project-template.js"
import { setUpTestDb, tearDownTestDb } from "../../../db/test-db-utils.js"
import { PlanEdgeRepository } from "../../../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../../../plan/nodes/plan-node-repository.js"
import { applyProjectTemplate } from "../../../projects/apply-project-template.js"

vi.mock("../../../settings/settings-repository.js", () => ({
  SettingsRepository: {
    getProjectTitle: () => "Fiction Arc Test",
  },
}))

const TEMPLATE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fiction-arc.ru.json")

describe("fiction-arc.ru.json bundled template", () => {
  let template: ProjectTemplate

  beforeEach(async () => {
    setUpTestDb()
    template = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8")) as ProjectTemplate
  })

  afterEach(() => {
    tearDownTestDb()
  })

  it("applies cleanly: all nodes are inserted, all input refs resolve, all fix-problems source titles resolve", () => {
    expect(() =>
      applyProjectTemplate(template, { synopsis: "Тестовый синопсис: молодой картограф находит карту..." }),
    ).not.toThrow()

    const nodes = new PlanNodeRepository().findAll()
    const edges = new PlanEdgeRepository().findAll()

    // Sanity counts: there is at least one of each major block type.
    const types = new Set(nodes.map((n) => n.type))
    expect(types).toContain("text")
    expect(types).toContain("split")
    expect(types).toContain("merge")
    expect(types).toContain("for-each")
    expect(types).toContain("for-each-input")
    expect(types).toContain("for-each-output")
    expect(types).toContain("for-each-index")
    expect(types).toContain("for-each-prev-outputs")
    expect(types).toContain("fix-problems")

    // Synopsis substitution from wizard data lands in content.
    const synopsis = nodes.find((n) => n.title === "Синопсис")!
    expect(synopsis.content).toMatch(/картограф/)

    // At least one edge crosses parent boundaries (otherwise the cross-parent
    // refactor wouldn't be needed for this template).
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const crossParent = edges.filter((e) => byId.get(e.from_node_id)!.parent_id !== byId.get(e.to_node_id)!.parent_id)
    expect(crossParent.length).toBeGreaterThan(0)
  })

  it("places three for-each containers (cast, first draft, second draft)", () => {
    applyProjectTemplate(template, { synopsis: "x" })
    const nodes = new PlanNodeRepository().findAll()
    const forEachs = nodes.filter((n) => n.type === "for-each")
    expect(forEachs).toHaveLength(3)
  })

  it("two for-each-index nodes live with unique titles (one per scene loop)", () => {
    applyProjectTemplate(template, { synopsis: "x" })
    const nodes = new PlanNodeRepository().findAll()
    const indices = nodes.filter((n) => n.type === "for-each-index")
    expect(indices).toHaveLength(2)
    const titles = new Set(indices.map((n) => n.title))
    expect(titles.size).toBe(2)
  })

  it("fix-problems nodes resolve sourceNodeTitleToFix to a real sibling id", () => {
    applyProjectTemplate(template, { synopsis: "x" })
    const nodes = new PlanNodeRepository().findAll()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const fixNodes = nodes.filter((n) => n.type === "fix-problems")
    expect(fixNodes.length).toBeGreaterThan(0)

    for (const fix of fixNodes) {
      const settings = JSON.parse(fix.node_type_settings!) as { sourceNodeIdToFix: number }
      const source = byId.get(settings.sourceNodeIdToFix)
      expect(source, `fix-problems #${fix.id} '${fix.title}' has unresolved sourceNodeIdToFix`).toBeDefined()
      // Sibling — both fix and source share the same parent in this template.
      expect(source!.parent_id).toBe(fix.parent_id)
    }
  })
})
