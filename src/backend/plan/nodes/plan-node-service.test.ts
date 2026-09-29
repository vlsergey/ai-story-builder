import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { childPath } from "../../../shared/plan-node-path.js"
import { generatePlanNodeTextContent } from "../../ai/generate-plan-node-text-content.js"
import { generateSplitParts } from "../../ai/generate-split-parts.js"
import { generateSummary } from "../../ai/generate-summary.js"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import { PlanEdgeRepository } from "../edges/plan-edge-repository.js"
import { PlanNodeService } from "./plan-node-service.js"

// ─── Mock AI generation ──────────────────────────────────────────────────────

vi.mock("../../ai/generate-plan-node-text-content.js", () => ({
  generatePlanNodeTextContent: vi.fn(),
}))

vi.mock("../../ai/generate-split-parts.js", () => ({
  generateSplitParts: vi.fn(),
}))

vi.mock("../../ai/generate-summary.js", () => ({
  generateSummary: vi.fn(),
}))

// ─── Helper to create test database ──────────────────────────────────────────

function setupTestSettings() {
  SettingsRepository.setCurrentBackend("grok")
  // Save config with defaultAiGenerationSettings
  SettingsRepository.setAllAiEnginesConfig({
    grok: {
      api_key: "fake-key",
      defaultAiGenerationSettings: {
        model: "grok-3",
        temperature: 0.7,
        maxTokens: 2000,
      },
    },
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PlanNodeService — full plan content generation", () => {
  beforeEach(() => {
    // Reset database state
    setUpTestDb()

    vi.resetAllMocks()
    // Mock AI generation to return predictable text
    ;(generatePlanNodeTextContent as any).mockImplementation(async (abortSignal: AbortSignal, node: any) => {
      console.log(
        `[MOCK] generatePlanNodeTextContent called for node ${node.id} title ${node.title} type ${node.type} parent_id ${node.parent_id}`,
      )
      // For text node with AI instruction generate dummy content
      if (node.title === "Text Node") {
        return "Сгенерированный текст для узла"
      }
      // For inner text node inside for-each (uses input)
      if (node.title === "Inner Text") {
        // Return fixed text that can later be checked in merge
        return `Сгенерированная часть для итерации`
      }
      return ""
    })
    ;(generateSummary as any).mockImplementation(async (promptCacheKeys: string[], content: string) => {
      console.log(`[MOCK] generateSummary called for content length ${content.length}`)
      return `Summary: ${content.substring(0, 30)}...`
    })
    ;(generateSplitParts as any).mockImplementation(async (_abortSignal: AbortSignal, node: any) => {
      console.log(`[MOCK] generateSplitParts called for node ${node.id} title ${node.title}`)
      // Test feeds "First par.\n\nSecond par." to the split node; mock returns two parts.
      return ["First par.", "Second par."]
    })
  })

  afterEach(() => {
    tearDownTestDb()
  })

  it("generates content for the whole plan with text, split, for-each and merge nodes", async () => {
    // 1. Create test database
    setupTestSettings()
    const service = new PlanNodeService()
    const edgeRepo = new PlanEdgeRepository()

    // 2. Create text node with two paragraphs (content already exists)
    const textNode = service.create({
      type: "text",
      title: "Text Node",
      content: "First par.\n\nSecond par.",
      node_type_settings: JSON.stringify({ userPrompt: "Generate text", systemPrompt: "You are AI helper" }),
      status: "EMPTY",
    })
    expect(textNode).toBeDefined()
    const textNodeId = textNode.id

    // 3. Create split node — LLM-driven now; the mock returns two parts.
    const splitNode = service.create({
      type: "split",
      title: "Split Node",
      content: null,
      status: "OUTDATED",
      node_type_settings: JSON.stringify({ userPrompt: "Split the input by paragraphs." }),
    })
    const splitNodeId = splitNode.id

    // Create edge from text node to split node
    edgeRepo.insert({
      from_node_id: textNodeId,
      to_node_id: splitNodeId,
      type: "text",
    })

    // 4. Create for-each node
    const forEachNode = service.create({
      type: "for-each",
      title: "ForEach Node",
      status: "EMPTY",
    })
    const forEachNodeId = forEachNode.id

    // Create edge from split node to for-each node (type textArray)
    edgeRepo.insert({
      from_node_id: splitNodeId,
      to_node_id: forEachNodeId,
      type: "textArray",
    })

    // After creating for-each node, internal input and output nodes are automatically created
    // Get their IDs
    const internalInputNodes = service.findByParentIdAndType(forEachNodeId, "for-each-input")
    const internalOutputNodes = service.findByParentIdAndType(forEachNodeId, "for-each-output")
    expect(internalInputNodes).toHaveLength(1)
    expect(internalOutputNodes).toHaveLength(1)
    const inputNodeId = internalInputNodes[0].id
    const outputNodeId = internalOutputNodes[0].id

    // 5. Create text node inside for-each (will use input)
    const innerTextNode = service.create({
      type: "text",
      title: "Inner Text",
      content: null,
      node_type_settings: JSON.stringify({ userPrompt: "Process input: {{Input}}", systemPrompt: "You are AI helper" }),
      status: "EMPTY",
      parent_id: forEachNodeId,
    })
    const innerTextNodeId = innerTextNode.id

    // Edge from input node to inner text node
    edgeRepo.insert({
      from_node_id: inputNodeId,
      to_node_id: innerTextNodeId,
      type: "text",
    })

    // Edge from inner text node to output node
    edgeRepo.insert({
      from_node_id: innerTextNodeId,
      to_node_id: outputNodeId,
      type: "text",
    })

    // 6. Create merge node
    const mergeNode = service.create({
      type: "merge",
      title: "Merge Node",
      content: null,
      status: "EMPTY",
      node_type_settings: JSON.stringify({
        includeNodeTitle: false,
        includeInputTitles: false,
        fixHeaders: false,
        autoUpdate: true, // Enable auto-update so merge node regenerates automatically
      }),
    })
    const mergeNodeId = mergeNode.id

    // Edge from for-each node to merge node (type textArray)
    edgeRepo.insert({
      from_node_id: forEachNodeId,
      to_node_id: mergeNodeId,
      type: "textArray",
    })

    // 7. Start regeneration of the whole plan
    // Debug check: ensure split node has input data
    const splitInputs = service.findNodeInputs(splitNodeId, "")
    console.log("Split inputs:", splitInputs)
    expect(splitInputs).toHaveLength(1)
    expect(splitInputs[0].input).toBe("First par.\n\nSecond par.")

    // Start regeneration of subtree (all nodes)
    const { regenerateTreeNodesContents } = await import("./generate/regenerateTreeNodesContents.js")
    await regenerateTreeNodesContents()

    // 8. Check split node was automatically regenerated
    const updatedSplitNode = service.getRow(splitNodeId, "")
    expect(updatedSplitNode.content).toBeTruthy()
    const splitParts = JSON.parse(updatedSplitNode.content!)
    expect(splitParts).toHaveLength(2)
    expect(splitParts[0]).toBe("First par.")
    expect(splitParts[1]).toBe("Second par.")

    // 9. The loop keeps only its length; each iteration has its own rows.
    const forEachNodeAfter = service.getRow(forEachNodeId, "")
    expect(JSON.parse(forEachNodeAfter.content || "{}")).toEqual({ length: 2 })
    for (let i = 0; i < 2; i++) {
      const path = childPath("", forEachNodeId, i)
      expect(service.getRow(inputNodeId, path).content, `element of iteration ${i}`).toBe(splitParts[i])
      expect(service.getRow(innerTextNodeId, path).status, `inner text of iteration ${i}`).toBe("GENERATED")
      expect(service.getRow(outputNodeId, path).content, `output of iteration ${i}`).toBe(
        "Сгенерированная часть для итерации",
      )
    }

    const mergeNodeAfter = service.getRow(mergeNodeId, "")

    // 12. Check specific strings in merge content
    const mergeContent = mergeNodeAfter?.content
    expect(mergeContent).toBeTruthy()
    // Mock returns for each iteration the string 'Сгенерированная часть для итерации'
    // Merge node will combine two such strings (possibly with separators)
    // Check that content contains two identical strings
    const expectedPart = "Сгенерированная часть для итерации"
    // Split content by double newlines
    const parts = mergeContent!.split("\n\n").filter((p) => p.trim().length > 0)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain(expectedPart)
    expect(parts[1]).toContain(expectedPart)
    // Can check exact match if merge node formatting is known
    // Merge node by default simply concatenates content with \n\n
    const expectedContent = `${expectedPart}\n\n${expectedPart}`
    expect(mergeContent).toBe(expectedContent)
  })
})
