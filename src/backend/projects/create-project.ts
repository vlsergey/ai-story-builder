import fs from "node:fs"
import path from "node:path"
import type { ProjectTemplate, TemplateProjectPlanNode } from "@shared/project-template.js"
import type { ProjectCreateOptions } from "../../shared/project-create-options.js"
import { openProjectDatabase } from "../db/index.js"
import { setCurrentDbPath } from "../db/state.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { LoreNodeRepository } from "../lore/lore-node-repository.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { getProjectsFolder } from "./project-folder.js"
import { getProjectInitialData } from "./project-state.js"
import { updateRecent } from "./recent-projects.js"
import { sanitizeProjectName } from "./sanitize-project-name.js"

export function createProject({ title, templateFilePath, templateData }: ProjectCreateOptions): {
  path: string
  layout: unknown
  projectTitle: string | null
  reused?: boolean
} {
  const safeName = sanitizeProjectName(title)
  const projectsDir = getProjectsFolder()
  fs.mkdirSync(projectsDir, { recursive: true })
  const dbPath = path.join(projectsDir, `${safeName}.sqlite`)

  if (fs.existsSync(dbPath)) {
    setCurrentDbPath(dbPath)
    updateRecent(dbPath)
    return { path: dbPath, reused: true, ...getProjectInitialData(dbPath) }
  }

  try {
    openProjectDatabase(dbPath)
    setCurrentDbPath(dbPath)

    // Create project from template if templatePath is specified
    if (templateFilePath) {
      importProjectFromTemplate(templateFilePath, templateData)
    }

    SettingsRepository.setProjectTitle(title)

    updateRecent(dbPath)

    return { path: dbPath, layout: null, projectTitle: title }
  } catch (e) {
    throw makeErrorWithStatus(String(e), 500)
  }
}

/*
 * Join all template lines into single line with line breaks (concatenate with \n) and replace all "${VALUE}" templates with template data
 */
function normalizeAndReplaceContent(templateValue: string[], templateData: Record<string, any>) {
  return templateValue.join("\n").replace(/\${([^}]+)}/g, (_match, key) => {
    return templateData[key] || ""
  })
}

function importProjectFromTemplate(templateFilePath: string, templateData: Record<string, any>): void {
  if (!fs.existsSync(templateFilePath)) {
    throw makeErrorWithStatus(`Template file not found: ${templateFilePath}`, 404)
  }
  const projectTemplate = JSON.parse(fs.readFileSync(templateFilePath, "utf8")) as ProjectTemplate

  const planRepo = new PlanNodeRepository()
  const edgeRepo = new PlanEdgeRepository()
  const loreRepo = new LoreNodeRepository()

  // Map old node ID -> new node ID
  const nodeIdMap = new Map<number, number>()

  // Recursive function to create plan nodes
  function createPlanNodes(nodes: TemplateProjectPlanNode[], parentId: number | null = null): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const { id, title, type, aiUserInstructions, nodeTypeSettings, children, content } = node

      // Insert node with position based on index
      const insertedId = planRepo.insert({
        title,
        type,
        parent_id: parentId,
        position: i,
        ai_user_prompt: aiUserInstructions ? normalizeAndReplaceContent(aiUserInstructions, templateData) : null,
        content: content ? normalizeAndReplaceContent(content, templateData) : null,
        node_type_settings: nodeTypeSettings ? JSON.stringify(nodeTypeSettings) : null,
      })

      nodeIdMap.set(id, insertedId)

      // Recursively create children
      if (children && children.length > 0) {
        createPlanNodes(children, insertedId)
      }
    }
  }

  // Create all plan nodes (starting from root nodes)
  if (projectTemplate.plan?.nodes) {
    createPlanNodes(projectTemplate.plan.nodes, null)
  }

  // Create edges based on inputs
  if (projectTemplate.plan?.nodes) {
    // Flatten all nodes to process inputs
    function flattenNodes(nodes: any[]): any[] {
      const flat: any[] = []
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

  // Create lore nodes if present
  if (projectTemplate.lore?.nodes) {
    const loreIdMap = new Map<number, number>()

    // Recursive function to create lore nodes
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

        // Recursively create children
        if (children && children.length > 0) {
          createLoreNodes(children, insertedId)
        }
      }
    }

    createLoreNodes(projectTemplate.lore.nodes, null)
  }
}
