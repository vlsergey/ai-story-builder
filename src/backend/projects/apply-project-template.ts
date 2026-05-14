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
export function normalizeAndReplaceContent(templateValue: string[], templateData: Record<string, any>) {
  return templateValue.join("\n").replace(/\${([^}]+)}/g, (_match, key) => {
    return templateData[key] || ""
  })
}

type ParentKey = number | "root"
function keyFor(parentId: number | null): ParentKey {
  return parentId ?? "root"
}

// for-each-input / for-each-output are auto-managed by the engine: their fixed
// titles ("Input" / "Output") legitimately repeat across multiple for-each
// containers. They are addressed only by siblings inside their own for-each,
// never globally. Excluded from global-uniqueness checks and from the global
// title→id map.
const INTERNAL_PLAN_NODE_TYPES = new Set<string>(["for-each-input", "for-each-output"])

function assertPlanTitlesGloballyUnique(nodes: TemplateProjectPlanNode[] | undefined): void {
  if (!nodes) return
  const seen = new Set<string>()
  function walk(arr: TemplateProjectPlanNode[]): void {
    for (const node of arr) {
      if (!INTERNAL_PLAN_NODE_TYPES.has(node.type)) {
        if (seen.has(node.title)) {
          throw new Error(
            `Template is invalid: two plan nodes share the title "${node.title}". Plan titles must be globally unique (auto-managed for-each-input / for-each-output are exempt).`,
          )
        }
        seen.add(node.title)
      }
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
}

function assertSiblingTitlesUnique<T extends { title: string; children?: T[] }>(
  nodes: T[] | undefined,
  kind: "lore",
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
 * Resolve a referenced node title to its inserted DB id. Sibling lookup first
 * (so internal for-each-input / for-each-output stays addressable), then a
 * global fallback so cross-parent references work without relative paths.
 */
function resolveSource(
  parentNewId: number | null,
  sourceTitle: string,
  titleByParent: Map<ParentKey, Map<string, number>>,
  titleByTitleGlobal: Map<string, number>,
): number | undefined {
  const sibling = titleByParent.get(keyFor(parentNewId))?.get(sourceTitle)
  if (sibling !== undefined) return sibling
  return titleByTitleGlobal.get(sourceTitle)
}

// In the template format, fix-problems' instruction fields are stored as
// `string[]` for diff-friendliness (same convention as text nodes'
// aiUserInstructions). Runtime expects a single `string`. Convert at apply
// time and apply wizard ${VARNAME} substitution while we're at it.
const FIX_PROBLEMS_PROMPT_FIELDS = [
  "aiSystemInstructionsToFindProblems",
  "aiSystemInstructionsToFixProblems",
  "aiUserInstructionsToFindProblems",
  "aiUserInstructionsToFixProblems",
] as const

function normalizeFixProblemsPromptFields(
  settings: Record<string, any>,
  templateData: Record<string, any>,
): Record<string, any> {
  const out = { ...settings }
  for (const field of FIX_PROBLEMS_PROMPT_FIELDS) {
    const value = out[field]
    if (Array.isArray(value)) {
      out[field] = normalizeAndReplaceContent(value as string[], templateData)
    }
  }
  return out
}

/**
 * Translate a fix-problems template's nodeTypeSettings (which references the source by title)
 * back into runtime form (referencing the source by DB id). Uses the same
 * sibling-then-global resolution as edge inputs.
 */
function translateFixProblemsSettingsToRuntime(
  templateSettings: Record<string, any>,
  _fixProblemsNewId: number,
  fixProblemsParentNewId: number | null,
  titleByParent: Map<ParentKey, Map<string, number>>,
  titleByTitleGlobal: Map<string, number>,
  fixProblemsTitle: string,
  templateData: Record<string, any>,
): Record<string, any> {
  const normalized = normalizeFixProblemsPromptFields(templateSettings, templateData)
  const { sourceNodeTitleToFix, ...rest } = normalized
  if (sourceNodeTitleToFix === undefined || sourceNodeTitleToFix === null) {
    return rest
  }
  const sourceId = resolveSource(fixProblemsParentNewId, sourceNodeTitleToFix, titleByParent, titleByTitleGlobal)
  if (sourceId === undefined) {
    throw new Error(
      `Template is invalid: fix-problems node "${fixProblemsTitle}" references missing node "${sourceNodeTitleToFix}" via sourceNodeTitleToFix.`,
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
    assertPlanTitlesGloballyUnique(projectTemplate.plan.nodes)
  }
  if (projectTemplate.lore?.nodes) {
    assertSiblingTitlesUnique(projectTemplate.lore.nodes, "lore", null)
  }

  // Index inserted plan nodes by (parent_id, title) for sibling lookups
  // (covers auto-managed for-each-input / for-each-output that share titles
  // across containers).
  const titleByParent = new Map<ParentKey, Map<string, number>>()
  // Flat map of non-internal plan titles → id for cross-parent reference
  // resolution. Excludes for-each-input / for-each-output.
  const titleByTitleGlobal = new Map<string, number>()
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

  function recordTitle(parentNewId: number | null, title: string, type: string, newId: number): void {
    const key = keyFor(parentNewId)
    let bucket = titleByParent.get(key)
    if (!bucket) {
      bucket = new Map()
      titleByParent.set(key, bucket)
    }
    bucket.set(title, newId)
    if (!INTERNAL_PLAN_NODE_TYPES.has(type)) {
      titleByTitleGlobal.set(title, newId)
    }
  }

  function createPlanNodes(nodes: TemplateProjectPlanNode[], parentNewId: number | null): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const { title, type, x, y, width, height, aiUserInstructions, nodeTypeSettings, children, content, inputs } = node

      // For LLM-calling types (text, split, lore), aiUserInstructions from the
      // template goes into node_type_settings.userPrompt. Other settings from the
      // template (if any) merge in as well. fix-problems is patched later with
      // sibling-id translation, so it gets a stub here.
      let initialSettings: Record<string, any> | null = null
      if (type === "fix-problems") {
        initialSettings = {}
      } else if (nodeTypeSettings || aiUserInstructions) {
        initialSettings = { ...(nodeTypeSettings ?? {}) }
        if (aiUserInstructions) {
          initialSettings.userPrompt = normalizeAndReplaceContent(aiUserInstructions, templateData)
        }
      }

      const finalContent = content ? normalizeAndReplaceContent(content, templateData) : null
      // Non-blank content from wizard substitution makes the node ready-to-use,
      // not pending regeneration. Status defaults to EMPTY otherwise — matching
      // PlanNodeService.create's branch.
      const hasContent = finalContent != null && finalContent.trim().length > 0
      const status = hasContent ? "MANUAL" : "EMPTY"

      const insertedId = planRepo.insert({
        title,
        type,
        parent_id: parentNewId,
        position: i,
        x: x ?? 0,
        y: y ?? 0,
        width: width ?? null,
        height: height ?? null,
        content: finalContent,
        node_type_settings: initialSettings ? JSON.stringify(initialSettings) : null,
        status,
      })

      recordTitle(parentNewId, title, type, insertedId)

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
    const sourceId = resolveSource(edge.parentNewId, edge.sourceNodeTitle, titleByParent, titleByTitleGlobal)
    if (sourceId === undefined) {
      throw new Error(
        `Template is invalid: node "${edge.targetTitle}" references missing node "${edge.sourceNodeTitle}" in inputs.`,
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
      titleByTitleGlobal,
      fp.title,
      templateData,
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
