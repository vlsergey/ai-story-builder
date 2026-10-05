import fs from "node:fs"
import path from "node:path"
import type { PlanNodeType } from "../../shared/plan-node-types.js"
import type {
  ProjectTemplate,
  TemplateProjectPlanNode,
  TemplateProjectPlanNodeInput,
  WizardField,
} from "../../shared/project-template.js"
import { buildFormSchema } from "../../shared/project-template-form.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { usesInput } from "../plan/nodes/input-relevance.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { PlanNodeService } from "../plan/nodes/plan-node-service.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { normalizeAndReplaceContent, wizardSubstitutions } from "./apply-project-template.js"
import { getTemplateFolders } from "./project-templates.js"

/**
 * Reconciles a project against its source template file.
 *
 * `analyze` reads `appliedTemplateFile` from project settings, loads the
 * fresh template from disk and produces a structural diff: which existing
 * nodes have updated instructions, which new nodes the template introduces,
 * which new input edges appear. Content fields (summary, status, generated
 * content, user edits) are never compared and never touched.
 *
 * `apply` performs the diff's instructions: overwrites instruction fields on
 * changed nodes (marking them OUTDATED), inserts new nodes, inserts new
 * edges. Project-only nodes/edges are left alone.
 */

export interface UpdatedNode {
  title: string
  type: string
}

/** A node the template now gives another type. */
export interface RetypedNode {
  title: string
  from: string
  to: string
}

export interface NewEdge {
  sourceTitle: string
  targetTitle: string
  type: string
}

export interface TemplateUpdateAnalysis {
  templateFile: string
  unchangedCount: number
  updatedNodes: UpdatedNode[]
  newNodes: UpdatedNode[]
  newEdges: NewEdge[]
  /**
   * Edges the project has and the template no longer does.
   *
   * Restricted to edges whose BOTH endpoints are titles the template defines:
   * an edge touching a node the user added by hand is the user's wiring, and
   * the template has no opinion about it. Removal is opt-in — see
   * `applyTemplateUpdate`.
   */
  removedEdges: NewEdge[]
  /**
   * Nodes whose type the template changed. An update does not change a
   * node's type: the project keeps its own, and the reason says why.
   */
  retypeBlocked: (RetypedNode & { reason: string })[]
  /**
   * The template's parameters an update may change — the wizard fields it
   * marks `editableOnUpdate` — with the value this update uses for each.
   */
  parameters: TemplateParameter[]
}

export interface TemplateParameter {
  /** The wizard page the field is on: the dialog groups the parameters by it. */
  page: { id: string; title: string }
  field: WizardField
  value: string
}

/**
 * New values for some of the template's parameters, as the dialog sends them.
 * Numbers come as numbers; the project keeps every value as a string.
 */
export type TemplateParameterChanges = Record<string, string | number>

function editableFields(template: ProjectTemplate): { page: TemplateParameter["page"]; field: WizardField }[] {
  return (template.wizardPages ?? []).flatMap((page) =>
    page.fields
      .filter((field) => field.editableOnUpdate && field.type !== "advice")
      .map((field) => ({ page: { id: page.id, title: page.title }, field })),
  )
}

/** The value a field has in the project, or the template's default where it has none. */
function heldValue(field: WizardField, wizardData: Record<string, string>): string {
  const held = wizardData[field.name]
  const fallback = "defaultValue" in field && field.defaultValue !== undefined ? String(field.defaultValue) : ""
  if (held === undefined) return fallback
  if (field.type === "select" && !field.options.some((option) => option.value === held)) return fallback
  return held
}

// Keys in node_type_settings that count as "instruction-shaped" for the
// template-update diff. The diff treats these as authored content that
// can drift between the project DB and a freshly-edited template; other
// keys (runtime-resolved ids, etc.) are ignored. `expectedPartsCount` and
// `partDescription` belong here for split nodes — they steer the LLM call.
const INSTRUCTION_KEYS_TEXTLIKE = ["userPrompt", "systemPrompt", "partDescription", "expectedPartsCount"] as const
const INSTRUCTION_KEYS_FIXPROBLEMS = [
  "aiUserInstructionsToFindProblems",
  "aiUserInstructionsToFixProblems",
  "aiSystemInstructionsToFindProblems",
  "aiSystemInstructionsToFixProblems",
  "maxIterations",
  "minSeverityToFix",
  "foundProblemsTemplate",
] as const
const INSTRUCTION_KEYS_FORMAT = ["template"] as const

/** The settings of a node type the template owns: an update rewrites them. */
function instructionKeys(type: string): readonly string[] {
  if (type === "fix-problems") return INSTRUCTION_KEYS_FIXPROBLEMS
  if (type === "format") return INSTRUCTION_KEYS_FORMAT
  return INSTRUCTION_KEYS_TEXTLIKE
}

/**
 * Settings the template only suggests: an update fills them in where the
 * project lacks them, and never overwrites them — from then on they are the
 * user's choice.
 */
const PREFERENCE_KEYS: Readonly<Record<string, readonly string[]>> = {
  format: ["saveNextToProject", "fileName"],
}

/** The preferences the template suggests and the project does not have yet. */
function missingPreferences(
  type: string,
  templateSettings: Record<string, unknown>,
  projectSettings: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of PREFERENCE_KEYS[type] ?? []) {
    if (k in templateSettings && !(k in projectSettings)) out[k] = templateSettings[k]
  }
  return out
}

function locateTemplateFile(filename: string): string {
  const folders = getTemplateFolders()
  for (const candidate of [path.join(folders.system, filename), path.join(folders.user, filename)]) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw makeErrorWithStatus(
    `Template "${filename}" not found in system or user template folders. Project might have been created from a now-removed template.`,
    404,
  )
}

interface AppliedContext {
  template: ProjectTemplate
  /** The values the project holds for the wizard fields, with the changes on top. */
  wizardData: Record<string, string>
  /** What each `${name}` becomes — see `wizardSubstitutions`. */
  substitutions: Record<string, unknown>
  filename: string
}

function loadAppliedContext(changes: TemplateParameterChanges = {}): AppliedContext {
  const filename = SettingsRepository.getAppliedTemplateFile()
  if (!filename) {
    throw makeErrorWithStatus("Project was not created from a template — no template to update from.", 400)
  }
  const filePath = locateTemplateFile(filename)
  const template = JSON.parse(fs.readFileSync(filePath, "utf8")) as ProjectTemplate
  const wizardData = { ...(SettingsRepository.getAppliedTemplateWizardData() ?? {}) }

  const editable = editableFields(template)
  for (const [name, value] of Object.entries(changes)) {
    const field = editable.find((e) => e.field.name === name)?.field
    if (!field) throw makeErrorWithStatus(`«${name}» is not a parameter an update may change`, 400)
    const checked = buildFormSchema([field]).safeParse({ [name]: value })
    if (!checked.success) throw makeErrorWithStatus(`«${field.label}» cannot be ${JSON.stringify(value)}`, 400)
    wizardData[name] = String(value)
  }
  return { template, wizardData, substitutions: wizardSubstitutions(template, wizardData), filename }
}

function walkTemplate(
  nodes: TemplateProjectPlanNode[] | undefined,
  out: TemplateProjectPlanNode[] = [],
): TemplateProjectPlanNode[] {
  if (!nodes) return out
  for (const n of nodes) {
    out.push(n)
    if (n.children) walkTemplate(n.children, out)
  }
  return out
}

/**
 * Build the same `node_type_settings` JSON object the apply pipeline would
 * produce for a given template node — except we DON'T translate
 * `sourceNodeTitleToFix` into a DB id (since that's a runtime concern and
 * the project already has its own resolved id). Compare against the project's
 * stored `node_type_settings` to detect drift.
 */
function buildTemplateInstructionSettings(
  node: TemplateProjectPlanNode,
  substitutions: Record<string, unknown>,
): Record<string, unknown> {
  // Substitute `${var}` inside string values of nodeTypeSettings so template
  // authors can wire wizard fields straight into settings (e.g. SplitSettings
  // `expectedPartsCount: "${chunksCount}"`). Mirrors apply-project-template.
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node.nodeTypeSettings ?? {})) {
    out[k] = typeof v === "string" ? normalizeAndReplaceContent([v], substitutions) : v
  }

  if (node.type === "fix-problems") {
    for (const k of [
      "aiSystemInstructionsToFindProblems",
      "aiSystemInstructionsToFixProblems",
      "aiUserInstructionsToFindProblems",
      "aiUserInstructionsToFixProblems",
    ] as const) {
      const v = out[k]
      if (Array.isArray(v)) {
        out[k] = normalizeAndReplaceContent(v as string[], substitutions)
      }
    }
    // sourceNodeTitleToFix → sourceNodeIdToFix is translated at apply time
    // against the DB. We can't replicate that translation cleanly here for
    // comparison purposes, so we strip both and assume that re-wiring after
    // a title rename is out of scope for the update flow.
    delete out.sourceNodeTitleToFix
  }

  if (node.aiUserInstructions) {
    out.userPrompt = normalizeAndReplaceContent(node.aiUserInstructions, substitutions)
  }

  return out
}

/**
 * Pick the instruction-shaped keys from a node_type_settings object so
 * comparing two settings objects ignores accidental field drift in other
 * keys (e.g., a future addition we don't care about yet).
 */
function pickInstructionFields(type: string, settings: Record<string, unknown> | null): Record<string, unknown> {
  if (!settings) return {}
  const out: Record<string, unknown> = {}
  for (const k of instructionKeys(type)) {
    if (k in settings) out[k] = settings[k]
  }
  return out
}

function parseProjectSettings(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function instructionsDiffer(
  type: string,
  templateSettings: Record<string, unknown>,
  projectSettings: Record<string, unknown>,
): boolean {
  const a = pickInstructionFields(type, templateSettings)
  const b = pickInstructionFields(type, projectSettings)
  return JSON.stringify(a) !== JSON.stringify(b)
}

/** Edges identified by (sourceTitle, targetTitle, type). For-each-internal aliases
 *  are not globally unique by title — see research note for the caveat.
 *
 *  Stored as nested Map: source title → target title → set of edge types. This
 *  gives O(1) `has`/`add` like a Set<string-key> would, without needing a
 *  separator-encoded composite key — which would either collide on titles that
 *  contain the separator or force unprintable bytes into the source file. */
type EdgeTripleStore = Map<string, Map<string, Set<string>>>

function addEdgeTriple(store: EdgeTripleStore, sourceTitle: string, targetTitle: string, type: string): boolean {
  let byTarget = store.get(sourceTitle)
  if (!byTarget) {
    byTarget = new Map()
    store.set(sourceTitle, byTarget)
  }
  let types = byTarget.get(targetTitle)
  if (!types) {
    types = new Set()
    byTarget.set(targetTitle, types)
  }
  if (types.has(type)) return false
  types.add(type)
  return true
}

function hasEdgeTriple(store: EdgeTripleStore, sourceTitle: string, targetTitle: string, type: string): boolean {
  return store.get(sourceTitle)?.get(targetTitle)?.has(type) ?? false
}

function templateEdgeTriples(template: ProjectTemplate): { store: EdgeTripleStore; list: NewEdge[] } {
  const list: NewEdge[] = []
  const store: EdgeTripleStore = new Map()
  for (const node of walkTemplate(template.plan?.nodes)) {
    if (!node.inputs) continue
    for (const input of node.inputs as TemplateProjectPlanNodeInput[]) {
      if (addEdgeTriple(store, input.sourceNodeTitle, node.title, input.type)) {
        list.push({ sourceTitle: input.sourceNodeTitle, targetTitle: node.title, type: input.type })
      }
    }
  }
  return { store, list }
}

function projectEdgeTriples(): EdgeTripleStore {
  const nodeRepo = new PlanNodeRepository()
  const edgeRepo = new PlanEdgeRepository()
  const allNodes = nodeRepo.findAll()
  const byId = new Map<number, string>(allNodes.map((n) => [n.id, n.title]))
  const store: EdgeTripleStore = new Map()
  for (const e of edgeRepo.findAll()) {
    const src = byId.get(e.from_node_id)
    const tgt = byId.get(e.to_node_id)
    if (!src || !tgt) continue
    addEdgeTriple(store, src, tgt, e.type)
  }
  return store
}

/** What an update would do — with `changes` to the template's parameters, if any. */
export function analyzeTemplateUpdate(changes: TemplateParameterChanges = {}): TemplateUpdateAnalysis {
  const { template, wizardData, substitutions, filename } = loadAppliedContext(changes)

  const templateNodes = walkTemplate(template.plan?.nodes)
  const projectNodes = new PlanNodeRepository().findAll()
  const projectByTitle = new Map(projectNodes.map((n) => [n.title, n]))

  let unchangedCount = 0
  const updatedNodes: UpdatedNode[] = []
  const newNodes: UpdatedNode[] = []
  const retypeBlocked: (RetypedNode & { reason: string })[] = []

  for (const tNode of templateNodes) {
    const projectNode = projectByTitle.get(tNode.title)
    if (!projectNode) {
      newNodes.push({ title: tNode.title, type: tNode.type })
      continue
    }
    if (tNode.type !== projectNode.type) {
      retypeBlocked.push({
        title: tNode.title,
        from: projectNode.type,
        to: tNode.type,
        reason: "an update does not change a node's type",
      })
    }
    const templateSettings = buildTemplateInstructionSettings(tNode, substitutions)
    const projectSettings = parseProjectSettings(projectNode.node_type_settings)
    const templateAiSettingsJson = tNode.aiSettings ? JSON.stringify(tNode.aiSettings) : null
    const aiSettingsDiff = templateAiSettingsJson !== (projectNode.ai_settings ?? null)
    const suggested = Object.keys(missingPreferences(tNode.type, templateSettings, projectSettings)).length > 0
    if (instructionsDiffer(tNode.type, templateSettings, projectSettings) || aiSettingsDiff || suggested) {
      updatedNodes.push({ title: tNode.title, type: tNode.type })
    } else {
      unchangedCount += 1
    }
  }

  const { store: tEdges, list: tEdgeList } = templateEdgeTriples(template)
  const pEdges = projectEdgeTriples()
  const newEdges: NewEdge[] = []
  for (const e of tEdgeList) {
    if (!hasEdgeTriple(pEdges, e.sourceTitle, e.targetTitle, e.type)) {
      newEdges.push(e)
    }
  }
  // The reverse direction: what the project still wires and the template
  // dropped. Only between nodes the template owns — anything touching a
  // project-only node is not the template's business.
  const templateTitles = new Set(templateNodes.map((n) => n.title))
  const removedEdges: NewEdge[] = []
  for (const [sourceTitle, byTarget] of pEdges) {
    if (!templateTitles.has(sourceTitle)) continue
    for (const [targetTitle, types] of byTarget) {
      if (!templateTitles.has(targetTitle)) continue
      for (const type of types) {
        if (!hasEdgeTriple(tEdges, sourceTitle, targetTitle, type)) {
          removedEdges.push({ sourceTitle, targetTitle, type })
        }
      }
    }
  }

  return {
    templateFile: filename,
    unchangedCount,
    updatedNodes,
    newNodes,
    newEdges,
    removedEdges,
    retypeBlocked,
    parameters: editableFields(template).map(({ page, field }) => ({
      page,
      field,
      value: heldValue(field, wizardData),
    })),
  }
}

export interface TemplateUpdateApplyResult {
  appliedAt: string
  updatedNodeCount: number
  newNodeCount: number
  newEdgeCount: number
  removedEdgeCount: number
}

export interface TemplateUpdateApplyOptions {
  /**
   * Also delete the edges in `analysis.removedEdges`.
   *
   * Off by default: the reconciler's standing rule is that it never deletes
   * anything the project has and the template does not. But a template that
   * drops an input leaves the project wired to a source its prompt no longer
   * mentions, and a dead input edge is not inert — it still demotes the node
   * to OUTDATED every time that source changes, so the node regenerates for
   * nothing.
   */
  removeMissingEdges?: boolean
  /** New values for parameters the template marks `editableOnUpdate`; the project keeps them. */
  parameters?: TemplateParameterChanges
}

export async function applyTemplateUpdate(
  options: TemplateUpdateApplyOptions = {},
): Promise<TemplateUpdateApplyResult> {
  const changes = options.parameters ?? {}
  const { template, wizardData, substitutions } = loadAppliedContext(changes)
  const analysis = analyzeTemplateUpdate(changes)
  const nodeRepo = new PlanNodeRepository()
  const edgeRepo = new PlanEdgeRepository()
  const nodeService = new PlanNodeService()

  // Lookup helpers for project state. Re-read on each apply because we may
  // insert new rows below.
  function projectByTitleNow(): Map<string, ReturnType<PlanNodeRepository["findAll"]>[number]> {
    return new Map(nodeRepo.findAll().map((n) => [n.title, n]))
  }

  // 1. Rewrite instruction fields on changed nodes.
  const templateNodes = walkTemplate(template.plan?.nodes)
  const templateByTitle = new Map(templateNodes.map((n) => [n.title, n]))
  let projectMap = projectByTitleNow()
  for (const { title } of analysis.updatedNodes) {
    const tNode = templateByTitle.get(title)
    const pNode = projectMap.get(title)
    if (!tNode || !pNode) continue
    const fresh = buildTemplateInstructionSettings(tNode, substitutions)
    // Preserve any unrelated keys we don't manage.
    const current = parseProjectSettings(pNode.node_type_settings)
    const merged: Record<string, unknown> = { ...current, ...missingPreferences(tNode.type, fresh, current) }
    for (const k of instructionKeys(tNode.type)) {
      if (k in fresh) merged[k] = fresh[k]
      else delete merged[k]
    }
    const aiSettingsForPatch: string | null = tNode.aiSettings ? JSON.stringify(tNode.aiSettings) : null
    nodeRepo.patch(pNode.id, {
      node_type_settings: JSON.stringify(merged),
      ai_settings: aiSettingsForPatch,
    })
    // New instructions: what the node produced in every iteration is stale.
    nodeService.demoteEverywhere(pNode.id)
  }

  // 2. Insert new nodes. Parent is resolved by parent's title (if the new
  //    node is nested under an existing-parent in the template).
  function findParentTitle(node: TemplateProjectPlanNode, root: TemplateProjectPlanNode[] | undefined): string | null {
    if (!root) return null
    for (const cand of root) {
      if (cand.children?.includes(node)) return cand.title
      const deeper = findParentTitle(node, cand.children)
      if (deeper !== null) return deeper
    }
    return null
  }
  for (const { title } of analysis.newNodes) {
    const tNode = templateByTitle.get(title)
    if (!tNode) continue
    projectMap = projectByTitleNow()
    const parentTitle = findParentTitle(tNode, template.plan?.nodes)
    const parentId = parentTitle ? (projectMap.get(parentTitle)?.id ?? null) : null

    const initial = buildTemplateInstructionSettings(tNode, substitutions)
    nodeService.checkContainer(tNode.type as PlanNodeType, parentId)
    const id = nodeRepo.insert({
      title: tNode.title,
      type: tNode.type as any,
      parent_id: parentId,
      x: tNode.x ?? 0,
      y: tNode.y ?? 0,
      width: tNode.width ?? null,
      height: tNode.height ?? null,
      node_type_settings: Object.keys(initial).length > 0 ? JSON.stringify(initial) : null,
      ai_settings: tNode.aiSettings ? JSON.stringify(tNode.aiSettings) : null,
    })
    nodeService.writeInitialState(id, null)
  }
  projectMap = projectByTitleNow()

  // 3. Insert new edges. Resolve source/target by title in the current
  //    project. Skip edges whose endpoints we can't resolve — that means a
  //    sibling-aliased title (for-each-input) ambiguous in the project; we
  //    don't try to be clever in MVP.
  for (const e of analysis.newEdges) {
    const src = projectMap.get(e.sourceTitle)
    const tgt = projectMap.get(e.targetTitle)
    if (!src || !tgt) continue
    nodeService.checkEdge(src.id, tgt.id)
    edgeRepo.insert({
      from_node_id: src.id,
      to_node_id: tgt.id,
      type: e.type as any,
    })
    // A new input the prompt reads: what the node produced did not have it.
    if (usesInput(tgt, src)) nodeService.demoteEverywhere(tgt.id)
  }

  // 4. Optionally drop edges the template no longer declares. The target
  //    loses an input, so what it generated was written against a different
  //    set of sources — demote it, but leave its content alone.
  let removedEdgeCount = 0
  if (options.removeMissingEdges) {
    projectMap = projectByTitleNow()
    for (const e of analysis.removedEdges) {
      const src = projectMap.get(e.sourceTitle)
      const tgt = projectMap.get(e.targetTitle)
      if (!src || !tgt) continue
      for (const row of edgeRepo.findByToNodeId(tgt.id)) {
        if (row.from_node_id !== src.id || row.type !== e.type) continue
        edgeRepo.delete(row.id)
        removedEdgeCount += 1
      }
      nodeService.demoteEverywhere(tgt.id)
    }
  }

  // 5. Keep the new parameter values: the next update compares against them.
  if (Object.keys(changes).length > 0) SettingsRepository.setAppliedTemplateWizardData(wizardData)

  return {
    appliedAt: new Date().toISOString(),
    updatedNodeCount: analysis.updatedNodes.length,
    newNodeCount: analysis.newNodes.length,
    newEdgeCount: analysis.newEdges.length,
    removedEdgeCount,
  }
}
