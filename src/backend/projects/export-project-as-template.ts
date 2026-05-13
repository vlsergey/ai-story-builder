import { promises as fs } from "node:fs"
import type { ExportProjectAsTemplateOptions } from "../../shared/export-as-template-options.js"
import type { PlanNodeRow } from "../../shared/plan-graph.js"
import type {
  ProjectTemplate,
  TemplateProjectLoreNode,
  TemplateProjectPlanNode,
} from "../../shared/project-template.js"
import { LoreNodeRepository } from "../lore/lore-node-repository.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { SettingsRepository } from "../settings/settings-repository.js"

function checkSiblingTitlesUnique(
  rows: ReadonlyArray<{ id: number; parent_id: number | null; title: string }>,
  kind: "plan" | "lore",
): void {
  const seen = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.parent_id ?? "root"}|${row.title}`
    const prev = seen.get(key)
    if (prev !== undefined) {
      throw new Error(
        `Cannot export template: two ${kind} nodes share the title "${row.title}" under the same parent (#${prev} and #${row.id}). Rename one of them before exporting.`,
      )
    }
    seen.set(key, row.id)
  }
}

function translateFixProblemsSettings(
  settings: Record<string, any>,
  idToTitle: Map<number, string>,
  nodeId: number,
  nodeTitle: string,
): Record<string, any> {
  const { sourceNodeIdToFix, ...rest } = settings
  if (sourceNodeIdToFix === undefined || sourceNodeIdToFix === null) {
    return rest
  }
  const title = idToTitle.get(sourceNodeIdToFix)
  if (title === undefined) {
    throw new Error(
      `Cannot export template: fix-problems node #${nodeId} ('${nodeTitle}') references missing source node #${sourceNodeIdToFix} via sourceNodeIdToFix.`,
    )
  }
  return { ...rest, sourceNodeTitleToFix: title }
}

function buildExportedPlanNode(node: PlanNodeRow, idToTitle: Map<number, string>): TemplateProjectPlanNode {
  const exported: TemplateProjectPlanNode = {
    title: node.title,
    type: node.type,
    x: node.x,
    y: node.y,
  }
  if (node.width !== null) exported.width = node.width
  if (node.height !== null) exported.height = node.height

  if (node.ai_user_prompt) {
    exported.aiUserInstructions = node.ai_user_prompt.split("\n").filter((line) => line.trim() !== "")
  }

  if (node.node_type_settings) {
    let parsed: Record<string, any> | null = null
    try {
      parsed = JSON.parse(node.node_type_settings)
    } catch {
      // ignore invalid JSON
    }
    if (parsed && typeof parsed === "object") {
      const settings = node.type === "fix-problems" ? translateFixProblemsSettings(parsed, idToTitle, node.id, node.title) : parsed
      if (Object.keys(settings).length > 0) {
        exported.nodeTypeSettings = settings
      }
    }
  }

  return exported
}

export async function exportProjectAsTemplate(options: ExportProjectAsTemplateOptions) {
  const { filePath, exportLoreStructure } = options
  const nodes = new PlanNodeRepository().findAll()
  const edges = new PlanEdgeRepository().findAll()
  const projectTitle = SettingsRepository.getProjectTitle() || ""

  checkSiblingTitlesUnique(nodes, "plan")

  const idToTitle = new Map<number, string>(nodes.map((n) => [n.id, n.title]))
  const rawNodesById = new Map<number, PlanNodeRow>(nodes.map((n) => [n.id, n]))
  const exportedById = new Map<number, TemplateProjectPlanNode>()

  for (const node of nodes) {
    exportedById.set(node.id, buildExportedPlanNode(node, idToTitle))
  }

  // Wire up children
  for (const node of nodes) {
    if (node.parent_id === null) continue
    const parent = exportedById.get(node.parent_id)
    if (!parent) continue
    parent.children = parent.children ?? []
    parent.children.push(exportedById.get(node.id)!)
  }

  // Wire up inputs (edges); enforce same-parent constraint
  for (const edge of edges) {
    const sourceRaw = rawNodesById.get(edge.from_node_id)
    const targetRaw = rawNodesById.get(edge.to_node_id)
    if (!sourceRaw || !targetRaw) continue
    if (sourceRaw.parent_id !== targetRaw.parent_id) {
      throw new Error(
        `Cannot export template: edge from #${sourceRaw.id} ('${sourceRaw.title}') to #${targetRaw.id} ('${targetRaw.title}') crosses parent boundaries, which the template format does not support.`,
      )
    }
    const target = exportedById.get(edge.to_node_id)!
    target.inputs = target.inputs ?? []
    target.inputs.push({ sourceNodeTitle: sourceRaw.title, type: edge.type })
  }

  const rootNodes = nodes.filter((n) => n.parent_id === null).map((n) => exportedById.get(n.id)!)

  const projectTemplate: ProjectTemplate = {
    label: projectTitle,
    description: "",
    wizardPages: [],
    plan: { nodes: rootNodes },
  }

  if (exportLoreStructure) {
    const allLoreNodes = new LoreNodeRepository().findAll()
    checkSiblingTitlesUnique(allLoreNodes, "lore")

    const childrenCount = new Map<number, number>()
    for (const node of allLoreNodes) {
      if (node.parent_id !== null) {
        childrenCount.set(node.parent_id, (childrenCount.get(node.parent_id) || 0) + 1)
      }
    }
    const loreFolderNodes = allLoreNodes.filter((n) => (childrenCount.get(n.id) ?? 0) > 0)

    const loreNodes: TemplateProjectLoreNode[] = loreFolderNodes.map((node) => ({
      title: node.title,
      ...(node.content ? { content: node.content.split("\n").filter((line) => line.trim() !== "") } : {}),
    }))

    if (loreNodes.length > 0) {
      projectTemplate.lore = { nodes: loreNodes }
    }
  }

  await fs.writeFile(filePath, JSON.stringify(projectTemplate, null, 2), "utf8")
}
