import { promises as fs } from "node:fs"
import type { ExportProjectAsTemplateOptions } from "../../../shared/export-as-template-options.js"
import type { ProjectTemplate } from "../../../shared/project-template.js"
import { LoreNodeRepository } from "../../lore/lore-node-repository.js"
import { SettingsRepository } from "../../settings/settings-repository.js"
import { PlanEdgeRepository } from "../edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../nodes/plan-node-repository.js"

export async function exportProjectAsTemplate(options: ExportProjectAsTemplateOptions) {
  const { filePath, exportLoreStructure } = options
  const nodes = new PlanNodeRepository().findAll()
  const edges = new PlanEdgeRepository().findAll()
  const projectTitle = SettingsRepository.getProjectTitle() || ""

  // Map node id to its exported representation
  const nodeMap = new Map<number, any>()
  const childrenMap = new Map<number, any[]>()

  // First pass: create basic node structure and build children map
  for (const node of nodes) {
    const exportedNode: any = {
      id: node.id,
      title: node.title,
      type: node.type,
    }

    // Add aiUserInstructions if ai_user_prompt exists
    if (node.ai_user_prompt) {
      exportedNode.aiUserInstructions = node.ai_user_prompt.split("\n").filter((line) => line.trim() !== "")
    }

    // Add nodeTypeSettings if node_type_settings exists
    if (node.node_type_settings) {
      try {
        exportedNode.nodeTypeSettings = JSON.parse(node.node_type_settings)
      } catch {
        // ignore invalid JSON
      }
    }

    // Store for later
    nodeMap.set(node.id, exportedNode)

    // Build children map
    const parentId = node.parent_id
    if (parentId !== null) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, [])
      }
      childrenMap.get(parentId)!.push(exportedNode)
    }
  }

  // Second pass: add inputs based on edges
  for (const edge of edges) {
    const targetNode = nodeMap.get(edge.to_node_id)
    if (!targetNode) continue

    if (!targetNode.inputs) {
      targetNode.inputs = []
    }

    targetNode.inputs.push({
      sourceNodeId: edge.from_node_id,
      type: edge.type,
    })
  }

  // Third pass: add children to parent nodes
  for (const [parentId, childNodes] of childrenMap) {
    const parentNode = nodeMap.get(parentId)
    if (parentNode) {
      parentNode.children = childNodes
    }
  }

  // Collect root nodes (parent_id === null)
  const rootNodes = Array.from(nodeMap.values()).filter((node) => {
    const originalNode = nodes.find((n) => n.id === node.id)
    return originalNode && originalNode.parent_id === null
  })

  // Construct the ProjectTemplate object
  const projectTemplate: ProjectTemplate = {
    label: projectTitle,
    description: "",
    wizardPages: [],
    plan: {
      nodes: rootNodes,
    },
  }

  // Add lore structure if requested
  if (exportLoreStructure) {
    const allLoreNodes = new LoreNodeRepository().findAll()

    // Build a map of parent to children count
    const childrenCount = new Map<number, number>()
    for (const node of allLoreNodes) {
      if (node.parent_id !== null) {
        childrenCount.set(node.parent_id, (childrenCount.get(node.parent_id) || 0) + 1)
      }
    }

    // Collect nodes that have children (folders)
    const loreFolderNodes = allLoreNodes.filter((node) => {
      return childrenCount.has(node.id) && childrenCount.get(node.id)! > 0
    })

    // Convert to TemplateProjectLoreNode (without children)
    const loreNodes = loreFolderNodes.map((node) => ({
      id: node.id,
      title: node.title,
      // content is optional, we can include it if it exists
      ...(node.content ? { content: node.content.split("\n").filter((line) => line.trim() !== "") } : {}),
    }))

    if (loreNodes.length > 0) {
      projectTemplate.lore = {
        nodes: loreNodes,
      }
    }
  }

  // Write to file
  await fs.writeFile(filePath, JSON.stringify(projectTemplate, null, 2), "utf8")
}
