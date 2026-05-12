import type { ProjectTemplate, TemplateProjectPlanNode } from "../../shared/project-template.js"
import { LoreNodeRepository } from "../lore/lore-node-repository.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"

/**
 * Join all template lines into single line with line breaks (concatenate with \n)
 * and replace all "${VALUE}" templates with template data.
 */
function normalizeAndReplaceContent(templateValue: string[], templateData: Record<string, any>) {
  return templateValue.join("\n").replace(/\${([^}]+)}/g, (_match, key) => {
    return templateData[key] || ""
  })
}

/**
 * Applies a parsed project template to the currently open project database:
 * creates plan nodes (with coordinates and sizes), edges and lore nodes.
 */
export function applyProjectTemplate(projectTemplate: ProjectTemplate, templateData: Record<string, any>): void {
  const planRepo = new PlanNodeRepository()
  const edgeRepo = new PlanEdgeRepository()
  const loreRepo = new LoreNodeRepository()

  // Map old node ID -> new node ID
  const nodeIdMap = new Map<number, number>()

  function createPlanNodes(nodes: TemplateProjectPlanNode[], parentId: number | null = null): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const { id, title, type, x, y, width, height, aiUserInstructions, nodeTypeSettings, children, content } = node

      const insertedId = planRepo.insert({
        title,
        type,
        parent_id: parentId,
        position: i,
        x: x ?? 0,
        y: y ?? 0,
        width: width ?? null,
        height: height ?? null,
        ai_user_prompt: aiUserInstructions ? normalizeAndReplaceContent(aiUserInstructions, templateData) : null,
        content: content ? normalizeAndReplaceContent(content, templateData) : null,
        node_type_settings: nodeTypeSettings ? JSON.stringify(nodeTypeSettings) : null,
      })

      nodeIdMap.set(id, insertedId)

      if (children && children.length > 0) {
        createPlanNodes(children, insertedId)
      }
    }
  }

  if (projectTemplate.plan?.nodes) {
    createPlanNodes(projectTemplate.plan.nodes, null)
  }

  if (projectTemplate.plan?.nodes) {
    function flattenNodes(nodes: TemplateProjectPlanNode[]): TemplateProjectPlanNode[] {
      const flat: TemplateProjectPlanNode[] = []
      for (const node of nodes) {
        flat.push(node)
        if (node.children) {
          flat.push(...flattenNodes(node.children))
        }
      }
      return flat
    }

    const allNodes = flattenNodes(projectTemplate.plan.nodes)
    for (const node of allNodes) {
      if (node.inputs && node.inputs.length > 0) {
        const targetNewId = nodeIdMap.get(node.id)
        if (!targetNewId) continue

        for (const input of node.inputs) {
          const sourceNewId = nodeIdMap.get(input.sourceNodeId)
          if (!sourceNewId) continue

          edgeRepo.insert({
            from_node_id: sourceNewId,
            to_node_id: targetNewId,
            type: input.type,
          })
        }
      }
    }
  }

  if (projectTemplate.lore?.nodes) {
    const loreIdMap = new Map<number, number>()

    function createLoreNodes(nodes: any[], parentId: number | null = null): void {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const { id, title, content, children } = node

        const insertedId = loreRepo.insert({
          title,
          content: content ? content.join("\n") : null,
          parent_id: parentId,
          position: i,
        })

        loreIdMap.set(id, insertedId)

        if (children && children.length > 0) {
          createLoreNodes(children, insertedId)
        }
      }
    }

    createLoreNodes(projectTemplate.lore.nodes, null)
  }
}
