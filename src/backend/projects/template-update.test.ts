import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectTemplate } from "../../shared/project-template.js"
import { setUpTestDb, tearDownTestDb } from "../db/test-db-utils.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { applyProjectTemplate } from "./apply-project-template.js"
import type { TemplateUpdateAnalysis } from "./template-update.js"

// Stub electron's `app.getPath` for project-templates.ts. vi.mock is hoisted
// above all top-level statements, so the tempDir creation has to happen
// inside vi.hoisted() to be visible to the mock factory.
const { tempDir } = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs")
  const { tmpdir } = require("node:os") as typeof import("node:os")
  const path = require("node:path") as typeof import("node:path")
  return { tempDir: mkdtempSync(path.join(tmpdir(), "tmpl-update-")) }
})
vi.mock("electron", () => {
  const electronStub = {
    app: {
      isPackaged: false,
      getPath: () => tempDir,
    },
  }
  return { ...electronStub, default: electronStub }
})

function writeTemplate(filename: string, template: ProjectTemplate): string {
  // The runtime template loader probes both system and user folders. In dev,
  // SYSTEM_TEMPLATES resolves to __dirname/resources/templates inside the
  // backend dist; in tests we don't run the dist, so the loader needs to find
  // the file via the user folder (app.getPath("userData")/templates) which
  // we've redirected to tempDir.
  const userDir = path.join(tempDir, "templates")
  const file = path.join(userDir, filename)
  mkdirSync(userDir, { recursive: true })
  writeFileSync(file, JSON.stringify(template))
  return file
}

function baseTemplate(): ProjectTemplate {
  return {
    label: "test",
    description: "test",
    wizardPages: [],
    plan: {
      nodes: [
        {
          title: "Root",
          type: "text",
          aiUserInstructions: ["Original root instructions"],
          inputs: [],
        },
        {
          title: "Child",
          type: "text",
          aiUserInstructions: ["Original child instructions"],
          inputs: [{ sourceNodeTitle: "Root", type: "text" }],
        },
      ],
    },
  } as ProjectTemplate
}

describe("template-update", () => {
  let analyzeTemplateUpdate: () => TemplateUpdateAnalysis
  let applyTemplateUpdate: (options?: {
    removeMissingEdges?: boolean
  }) => Promise<{ updatedNodeCount: number; newNodeCount: number; newEdgeCount: number; removedEdgeCount: number }>

  beforeEach(async () => {
    setUpTestDb()
    const mod = await import("./template-update.js")
    analyzeTemplateUpdate = mod.analyzeTemplateUpdate
    applyTemplateUpdate = mod.applyTemplateUpdate
  })

  afterEach(() => {
    tearDownTestDb()
  })

  it("reports no changes when project and template are identical", () => {
    const tmpl = baseTemplate()
    writeTemplate("equal.json", tmpl)
    applyProjectTemplate(tmpl, {})
    SettingsRepository.setAppliedTemplateFile("equal.json")
    SettingsRepository.setAppliedTemplateWizardData({})

    const analysis = analyzeTemplateUpdate()
    expect(analysis.updatedNodes).toEqual([])
    expect(analysis.newNodes).toEqual([])
    expect(analysis.newEdges).toEqual([])
    expect(analysis.unchangedCount).toBe(2)
  })

  it("detects updated instructions and bumps status to OUTDATED on apply", async () => {
    const initial = baseTemplate()
    applyProjectTemplate(initial, {})
    SettingsRepository.setAppliedTemplateFile("updated.json")
    SettingsRepository.setAppliedTemplateWizardData({})

    // Mark project's root node as GENERATED — the apply must demote to OUTDATED.
    const planRepo = new PlanNodeRepository()
    const root = planRepo.findAll().find((n) => n.title === "Root")!
    planRepo.patch(root.id, { status: "GENERATED", content: "user's generated text" })

    // Write a NEW version of the template — root instructions changed.
    const updated = baseTemplate()
    updated.plan!.nodes![0].aiUserInstructions = ["BRAND NEW root instructions"]
    writeTemplate("updated.json", updated)

    const analysis = analyzeTemplateUpdate()
    expect(analysis.updatedNodes.map((n) => n.title)).toEqual(["Root"])
    expect(analysis.unchangedCount).toBe(1)

    const result = await applyTemplateUpdate()
    expect(result.updatedNodeCount).toBe(1)

    const after = new PlanNodeRepository().findAll().find((n) => n.title === "Root")!
    expect(after.status).toBe("OUTDATED")
    expect(after.content, "content must NOT be touched on update").toBe("user's generated text")
    const settings = JSON.parse(after.node_type_settings || "{}")
    expect(settings.userPrompt).toBe("BRAND NEW root instructions")
  })

  it("adds new template nodes and new edges; does not touch project-only nodes/edges", async () => {
    const initial = baseTemplate()
    applyProjectTemplate(initial, {})
    SettingsRepository.setAppliedTemplateFile("added.json")
    SettingsRepository.setAppliedTemplateWizardData({})

    // Add a project-only node + edge — must survive untouched.
    const planRepo = new PlanNodeRepository()
    const orphanId = planRepo.insert({
      title: "Project-only",
      type: "text",
      parent_id: null,
      x: 0,
      y: 0,
      width: null,
      height: null,
      content: "kept",
      node_type_settings: null,
      status: "MANUAL",
    })
    const rootId = planRepo.findAll().find((n) => n.title === "Root")!.id
    const edgeRepo = new PlanEdgeRepository()
    edgeRepo.insert({ from_node_id: rootId, to_node_id: orphanId, type: "text" })

    // New template: adds Sibling node + edge Root → Child of new "summary" type.
    const updated = baseTemplate()
    updated.plan!.nodes!.push({
      title: "Sibling",
      type: "text",
      aiUserInstructions: ["I am new"],
      inputs: [{ sourceNodeTitle: "Root", type: "text" }],
    } as any)
    writeTemplate("added.json", updated)

    const analysis = analyzeTemplateUpdate()
    expect(analysis.newNodes.map((n) => n.title)).toEqual(["Sibling"])
    expect(analysis.newEdges.map((e) => `${e.sourceTitle}->${e.targetTitle}`)).toEqual(["Root->Sibling"])

    const result = await applyTemplateUpdate()
    expect(result.newNodeCount).toBe(1)
    expect(result.newEdgeCount).toBe(1)

    const after = new PlanNodeRepository().findAll()
    const sibling = after.find((n) => n.title === "Sibling")
    expect(sibling).toBeTruthy()
    expect(sibling?.status).toBe("EMPTY")

    // Project-only survives, edge to it survives.
    expect(after.find((n) => n.title === "Project-only")?.content).toBe("kept")
    const edges = new PlanEdgeRepository().findAll()
    expect(edges.some((e) => e.from_node_id === rootId && e.to_node_id === orphanId)).toBe(true)
  })

  it("demotes a for-each child across ALL iterations and demotes the for-each itself", async () => {
    // Template: for-each "Loop" with one user-defined child "Loop child".
    const initial: ProjectTemplate = {
      label: "loop",
      description: "loop",
      wizardPages: [],
      plan: {
        nodes: [
          { title: "Source", type: "text", aiUserInstructions: ["src"], inputs: [] },
          {
            title: "Loop",
            type: "for-each",
            inputs: [{ sourceNodeTitle: "Source", type: "textArray" }],
            children: [
              { title: "Iter input", type: "for-each-input" },
              {
                title: "Loop child",
                type: "text",
                aiUserInstructions: ["Original child instructions"],
                inputs: [{ sourceNodeTitle: "Iter input", type: "text" }],
              },
            ],
          },
        ],
      },
    } as any
    applyProjectTemplate(initial, {})
    SettingsRepository.setAppliedTemplateFile("loop.json")
    SettingsRepository.setAppliedTemplateWizardData({})

    const planRepo = new PlanNodeRepository()
    const all = planRepo.findAll()
    const loop = all.find((n) => n.title === "Loop")!
    const child = all.find((n) => n.title === "Loop child")!

    // Seed the for-each with 3 iterations. Iter 0 and iter 2 snapshots
    // both have Child as GENERATED. Current iter is 1, also GENERATED.
    const mkOverride = (s: string) => ({
      [`${child.id}`]: {
        status: "GENERATED",
        content: s,
        summary: null,
        word_count: null,
        char_count: null,
        byte_count: null,
      },
    })
    const overrides = [mkOverride("iter0"), mkOverride("iter1"), mkOverride("iter2")]
    planRepo.patch(loop.id, {
      content: JSON.stringify({ length: 3, currentIndex: 1, overrides }),
      status: "GENERATED",
    })
    planRepo.patch(child.id, { status: "GENERATED", content: "iter1" })

    // Template changes Child's instructions.
    const updated = JSON.parse(JSON.stringify(initial)) as ProjectTemplate
    ;(updated.plan as any).nodes[1].children[1].aiUserInstructions = ["BRAND NEW child instructions"]
    writeTemplate("loop.json", updated)

    const analysis = analyzeTemplateUpdate()
    expect(analysis.updatedNodes.map((n) => n.title)).toEqual(["Loop child"])

    await applyTemplateUpdate()

    const afterAll = new PlanNodeRepository().findAll()
    const afterChild = afterAll.find((n) => n.id === child.id)!
    const afterLoop = afterAll.find((n) => n.id === loop.id)!

    expect(afterChild.status, "child row OUTDATED").toBe("OUTDATED")
    expect(afterLoop.status, "for-each itself OUTDATED").toBe("OUTDATED")
    const loopContent = JSON.parse(afterLoop.content || "{}")
    expect(loopContent.overrides).toHaveLength(3)
    loopContent.overrides.forEach((ov: any, i: number) => {
      const entry = ov[`${child.id}`]
      expect(entry?.status, `iter ${i} override status`).toBe("OUTDATED")
    })
  })

  it("re-substitutes wizard variables when comparing", () => {
    const initial: ProjectTemplate = {
      ...baseTemplate(),
      wizardPages: [{ id: "p", title: "p", fields: [{ name: "who", label: "who", type: "text" } as any] }],
    }
    // Concatenated to defuse biome's noTemplateCurlyInString — ${who} is the
    // intentional wizard-substitution syntax our apply pipeline interprets.
    initial.plan!.nodes![0].aiUserInstructions = [`Hello ${"$"}{who}`]
    applyProjectTemplate(initial, { who: "world" })
    SettingsRepository.setAppliedTemplateFile("wizard.json")
    SettingsRepository.setAppliedTemplateWizardData({ who: "world" })

    // Same template — wizardData re-substituted should match exactly, no diff.
    writeTemplate("wizard.json", initial)
    const analysis = analyzeTemplateUpdate()
    expect(analysis.updatedNodes).toEqual([])
    expect(analysis.unchangedCount).toBe(2)
  })

  it("reports an edge the template dropped, but only between nodes the template owns", () => {
    const initial = baseTemplate()
    applyProjectTemplate(initial, {})
    SettingsRepository.setAppliedTemplateFile("dropped.json")
    SettingsRepository.setAppliedTemplateWizardData({})

    // A hand-wired edge inside the project. The template knows nothing about
    // «Project-only», so this edge is the user's business, not the template's.
    const planRepo = new PlanNodeRepository()
    const edgeRepo = new PlanEdgeRepository()
    const mine = planRepo.insert({ title: "Project-only", type: "text", parent_id: null, x: 0, y: 0 })
    const root = planRepo.findAll().find((n) => n.title === "Root")!
    edgeRepo.insert({ from_node_id: root.id, to_node_id: mine, type: "text" })

    // New template version: Child no longer reads Root.
    const dropped = baseTemplate()
    dropped.plan!.nodes![1].inputs = []
    writeTemplate("dropped.json", dropped)

    const analysis = analyzeTemplateUpdate()
    expect(analysis.removedEdges).toEqual([{ sourceTitle: "Root", targetTitle: "Child", type: "text" }])
  })

  it("keeps dropped edges by default — removal is opt-in", async () => {
    const initial = baseTemplate()
    applyProjectTemplate(initial, {})
    SettingsRepository.setAppliedTemplateFile("keep.json")
    SettingsRepository.setAppliedTemplateWizardData({})
    const dropped = baseTemplate()
    dropped.plan!.nodes![1].inputs = []
    writeTemplate("keep.json", dropped)

    const result = await applyTemplateUpdate()
    expect(result.removedEdgeCount).toBe(0)
    expect(new PlanEdgeRepository().findAll()).toHaveLength(1)
  })

  it("removes dropped edges when asked, leaving hand-wired ones alone", async () => {
    const initial = baseTemplate()
    applyProjectTemplate(initial, {})
    SettingsRepository.setAppliedTemplateFile("remove.json")
    SettingsRepository.setAppliedTemplateWizardData({})

    const planRepo = new PlanNodeRepository()
    const edgeRepo = new PlanEdgeRepository()
    const mine = planRepo.insert({ title: "Project-only", type: "text", parent_id: null, x: 0, y: 0 })
    const root = planRepo.findAll().find((n) => n.title === "Root")!
    edgeRepo.insert({ from_node_id: root.id, to_node_id: mine, type: "text" })

    const dropped = baseTemplate()
    dropped.plan!.nodes![1].inputs = []
    writeTemplate("remove.json", dropped)

    const result = await applyTemplateUpdate({ removeMissingEdges: true })
    expect(result.removedEdgeCount).toBe(1)

    const nodes = new PlanNodeRepository().findAll()
    const byId = new Map(nodes.map((n) => [n.id, n.title]))
    const left = new PlanEdgeRepository()
      .findAll()
      .map((e) => `${byId.get(e.from_node_id)} → ${byId.get(e.to_node_id)}`)
    expect(left, "hand-wired edge must survive").toEqual(["Root → Project-only"])
  })

  it("demotes the target of a removed edge — its inputs changed", async () => {
    const initial = baseTemplate()
    applyProjectTemplate(initial, {})
    SettingsRepository.setAppliedTemplateFile("demote.json")
    SettingsRepository.setAppliedTemplateWizardData({})

    const planRepo = new PlanNodeRepository()
    const child = planRepo.findAll().find((n) => n.title === "Child")!
    planRepo.patch(child.id, { status: "GENERATED", content: "written against the old inputs" })

    const dropped = baseTemplate()
    dropped.plan!.nodes![1].inputs = []
    writeTemplate("demote.json", dropped)

    await applyTemplateUpdate({ removeMissingEdges: true })

    const after = new PlanNodeRepository().findAll().find((n) => n.title === "Child")!
    expect(after.status).toBe("OUTDATED")
    expect(after.content, "content is not touched").toBe("written against the old inputs")
  })
})
