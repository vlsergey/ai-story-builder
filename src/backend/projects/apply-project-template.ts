import type {
  ProjectTemplate,
  TemplateProjectLoreNode,
  TemplateProjectPlanNode,
} from "../../shared/project-template.js"
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

type ParentKey = number | "root"
function keyFor(parentId: number | null): ParentKey {
  return parentId ?? "root"
}

function assertSiblingTitlesUnique<T extends { title: string; children?: T[] }>(
  nodes: T[] | undefined,
  kind: "plan" | "lore",
  parentTitle: string | null,
): void {
  if (!nodes) return
  const seen = new Set<string>()
  for (const node of nodes) {
    if (seen.has(node.title)) {
      const where = parentTitle === null ? "at the top level" : `under "${parentTitle}"`
      throw new Error(
        `Template is invalid: two ${kind} nodes share the title "${node.title}" ${where}. Titles must be unique among siblings.`,
      )
    }
    seen.add(node.title)
    assertSiblingTitlesUnique(node.children, kind, node.title)
  }
}

/**
 * Translate a fix-problems template's nodeTypeSettings (which references the source by title)
 * back into runtime form (referencing the source by DB id). Looks up the sibling of the
 * fix-problems node whose title matches sourceNodeTitleToFix.
 */
function translateFixProblemsSettingsToRuntime(
  templateSettings: Record<string, any>,
  fixProblemsNewId: number,
  fixProblemsParentNewId: number | null,
  titleByParent: Map<ParentKey, Map<string, number>>,
  fixProblemsTitle: string,
): Record<string, any> {
  const { sourceNodeTitleToFix, ...rest } = templateSettings
  if (sourceNodeTitleToFix === undefined || sourceNodeTitleToFix === null) {
    return rest
  }
  const siblings = titleByParent.get(keyFor(fixProblemsParentNewId))
  const sourceId = siblings?.get(sourceNodeTitleToFix)
  if (sourceId === undefined) {
    throw new Error(
      `Template is invalid: fix-problems node "${fixProblemsTitle}" references missing sibling "${sourceNodeTitleToFix}" via sourceNodeTitleToFix.`,
    )
  }
  return { ...rest, sourceNodeIdToFix: sourceId }
}

/**
 * Applies a parsed project template to the currently open project database:
 * creates plan nodes (with coordinates and sizes), edges and lore nodes.
 */
export function applyProjectTemplate(projectTemplate: ProjectTemplate, templateData: Record<string, any>): void {
  const planRepo = new PlanNodeRepository()
  const edgeRepo = new PlanEdgeRepository()
  const loreRepo = new LoreNodeRepository()

  if (projectTemplate.plan?.nodes) {
    assertSiblingTitlesUnique(projectTemplate.plan.nodes, "plan", null)
  }
  if (projectTemplate.lore?.nodes) {
    assertSiblingTitlesUnique(projectTemplate.lore.nodes, "lore", null)
  }

  // Index inserted plan nodes by (parent_id, title) for sibling lookups (edges, fix-problems settings).
  const titleByParent = new Map<ParentKey, Map<string, number>>()
  // Track fix-problems nodes for a post-insert settings translation pass.
  const fixProblemsToWire: Array<{
    newId: number
    parentNewId: number | null
    title: string
    templateSettings: Record<string, any>
  }> = []
  // Track edges to insert after all nodes are present.
  const edgesToInsert: Array<{
    targetNewId: number
    parentNewId: number | null
    sourceNodeTitle: string
    type: import("../../shared/plan-edge-types.js").PlanEdgeType
    targetTitle: string
  }> = []

  function recordTitle(parentNewId: number | null, title: string, newId: number): void {
    const key = keyFor(parentNewId)
    let bucket = titleByParent.get(key)
    if (!bucket) {
      bucket = new Map()
      titleByParent.set(key, bucket)
    }
    bucket.set(title, newId)
  }

  function createPlanNodes(nodes: TemplateProjectPlanNode[], parentNewId: number | null): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const { title, type, x, y, width, height, aiUserInstructions, nodeTypeSettings, children, content, inputs } = node

      const insertedId = planRepo.insert({
        title,
        type,
        parent_id: parentNewId,
        position: i,
        x: x ?? 0,
        y: y ?? 0,
        width: width ?? null,
        height: height ?? null,
        ai_user_prompt: aiUserInstructions ? normalizeAndReplaceContent(aiUserInstructions, templateData) : null,
        content: content ? normalizeAndReplaceContent(content, templateData) : null,
        // fix-problems settings are patched after all siblings are inserted; store a stub for now.
        node_type_settings:
          nodeTypeSettings && type !== "fix-problems"
            ? JSON.stringify(nodeTypeSettings)
            : type === "fix-problems"
              ? JSON.stringify({})
              : null,
      })

      recordTitle(parentNewId, title, insertedId)

      if (type === "fix-problems" && nodeTypeSettings) {
        fixProblemsToWire.push({
          newId: insertedId,
          parentNewId,
          title,
          templateSettings: nodeTypeSettings,
        })
      }

      if (inputs && inputs.length > 0) {
        for (const input of inputs) {
          edgesToInsert.push({
            targetNewId: insertedId,
            parentNewId,
            sourceNodeTitle: input.sourceNodeTitle,
            type: input.type,
            targetTitle: title,
          })
        }
      }

      if (children && children.length > 0) {
        createPlanNodes(children, insertedId)
      }
    }
  }

  if (projectTemplate.plan?.nodes) {
    createPlanNodes(projectTemplate.plan.nodes, null)
  }

  for (const edge of edgesToInsert) {
    const sourceId = titleByParent.get(keyFor(edge.parentNewId))?.get(edge.sourceNodeTitle)
    if (sourceId === undefined) {
      throw new Error(
        `Template is invalid: node "${edge.targetTitle}" references missing sibling "${edge.sourceNodeTitle}" in inputs.`,
      )
    }
    edgeRepo.insert({
      from_node_id: sourceId,
      to_node_id: edge.targetNewId,
      type: edge.type,
    })
  }

  for (const fp of fixProblemsToWire) {
    const runtimeSettings = translateFixProblemsSettingsToRuntime(
      fp.templateSettings,
      fp.newId,
      fp.parentNewId,
      titleByParent,
      fp.title,
    )
    planRepo.patch(fp.newId, { node_type_settings: JSON.stringify(runtimeSettings) })
  }

  if (projectTemplate.lore?.nodes) {
    function createLoreNodes(nodes: TemplateProjectLoreNode[], parentId: number | null): void {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const { title, content, children } = node

        const insertedId = loreRepo.insert({
          title,
          content: content ? content.join("\n") : null,
          parent_id: parentId,
          position: i,
        })

        if (children && children.length > 0) {
          createLoreNodes(children, insertedId)
        }
      }
    }

    createLoreNodes(projectTemplate.lore.nodes, null)
  }
}
