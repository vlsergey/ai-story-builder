import fs from "node:fs"
import path from "node:path"
import type {
  ProjectTemplate,
  TemplateProjectPlanNode,
  TemplateProjectPlanNodeInput,
} from "../../shared/project-template.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { PlanNodeService } from "../plan/nodes/plan-node-service.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { normalizeAndReplaceContent } from "./apply-project-template.js"
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
 *
 * Design notes in [.claude/research/template-update.md](.claude/research/template-update.md).
 */

export interface UpdatedNode {
  title: string
  type: string
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
}

const INSTRUCTION_KEYS_TEXTLIKE = ["userPrompt", "systemPrompt"] as const
const INSTRUCTION_KEYS_FIXPROBLEMS = [
  "aiUserInstructionsToFindProblems",
  "aiUserInstructionsToFixProblems",
  "aiSystemInstructionsToFindProblems",
  "aiSystemInstructionsToFixProblems",
  "maxIterations",
  "minSeverityToFix",
  "foundProblemsTemplate",
] as const

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

function loadAppliedContext(): { template: ProjectTemplate; wizardData: Record<string, string>; filename: string } {
  const filename = SettingsRepository.getAppliedTemplateFile()
  if (!filename) {
    throw makeErrorWithStatus("Project was not created from a template — no template to update from.", 400)
  }
  const filePath = locateTemplateFile(filename)
  const template = JSON.parse(fs.readFileSync(filePath, "utf8")) as ProjectTemplate
  const wizardData = SettingsRepository.getAppliedTemplateWizardData() ?? {}
  return { template, wizardData, filename }
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
  wizardData: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(node.nodeTypeSettings ?? {}) }

  if (node.type === "fix-problems") {
    for (const k of [
      "aiSystemInstructionsToFindProblems",
      "aiSystemInstructionsToFixProblems",
      "aiUserInstructionsToFindProblems",
      "aiUserInstructionsToFixProblems",
    ] as const) {
      const v = out[k]
      if (Array.isArray(v)) {
        out[k] = normalizeAndReplaceContent(v as string[], wizardData)
      }
    }
    // sourceNodeTitleToFix → sourceNodeIdToFix is translated at apply time
    // against the DB. We can't replicate that translation cleanly here for
    // comparison purposes, so we strip both and assume that re-wiring after
    // a title rename is out of scope for the update flow.
    delete out.sourceNodeTitleToFix
  }

  if (node.aiUserInstructions) {
    out.userPrompt = normalizeAndReplaceContent(node.aiUserInstructions, wizardData)
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
  const keys: readonly string[] = type === "fix-problems" ? INSTRUCTION_KEYS_FIXPROBLEMS : INSTRUCTION_KEYS_TEXTLIKE
  const out: Record<string, unknown> = {}
  for (const k of keys) {
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

export function analyzeTemplateUpdate(): TemplateUpdateAnalysis {
  const { template, wizardData, filename } = loadAppliedContext()

  const templateNodes = walkTemplate(template.plan?.nodes)
  const projectNodes = new PlanNodeRepository().findAll()
  const projectByTitle = new Map(projectNodes.map((n) => [n.title, n]))

  let unchangedCount = 0
  const updatedNodes: UpdatedNode[] = []
  const newNodes: UpdatedNode[] = []

  for (const tNode of templateNodes) {
    const projectNode = projectByTitle.get(tNode.title)
    if (!projectNode) {
      newNodes.push({ title: tNode.title, type: tNode.type })
      continue
    }
    const templateSettings = buildTemplateInstructionSettings(tNode, wizardData)
    const projectSettings = parseProjectSettings(projectNode.node_type_settings)
    const templateAiSettingsJson = tNode.aiSettings ? JSON.stringify(tNode.aiSettings) : null
    const aiSettingsDiff = templateAiSettingsJson !== (projectNode.ai_settings ?? null)
    if (instructionsDiffer(tNode.type, templateSettings, projectSettings) || aiSettingsDiff) {
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
  // tEdges retained for symmetric API obviousness; unused in MVP.
  void tEdges

  return {
    templateFile: filename,
    unchangedCount,
    updatedNodes,
    newNodes,
    newEdges,
  }
}

export interface TemplateUpdateApplyResult {
  appliedAt: string
  updatedNodeCount: number
  newNodeCount: number
  newEdgeCount: number
}

export async function applyTemplateUpdate(): Promise<TemplateUpdateApplyResult> {
  const { template, wizardData } = loadAppliedContext()
  const analysis = analyzeTemplateUpdate()
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
    const fresh = buildTemplateInstructionSettings(tNode, wizardData)
    // Preserve any unrelated keys we don't manage.
    const current = parseProjectSettings(pNode.node_type_settings)
    const keys: readonly string[] =
      tNode.type === "fix-problems" ? INSTRUCTION_KEYS_FIXPROBLEMS : INSTRUCTION_KEYS_TEXTLIKE
    const merged: Record<string, unknown> = { ...current }
    for (const k of keys) {
      if (k in fresh) merged[k] = fresh[k]
      else delete merged[k]
    }
    const aiSettingsForPatch: string | null = tNode.aiSettings ? JSON.stringify(tNode.aiSettings) : null
    nodeRepo.patch(pNode.id, {
      node_type_settings: JSON.stringify(merged),
      ai_settings: aiSettingsForPatch,
    })
    // Demote via the service so each container parent (e.g. for-each) gets
    // a chance to mirror the demotion into its per-iteration snapshots and
    // recursively bubble OUTDATED up to its own ancestors.
    await nodeService.demoteToOutdated(pNode.id)
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

    const initial = buildTemplateInstructionSettings(tNode, wizardData)
    nodeRepo.insert({
      title: tNode.title,
      type: tNode.type as any,
      parent_id: parentId,
      x: tNode.x ?? 0,
      y: tNode.y ?? 0,
      width: tNode.width ?? null,
      height: tNode.height ?? null,
      content: null,
      node_type_settings: Object.keys(initial).length > 0 ? JSON.stringify(initial) : null,
      ai_settings: tNode.aiSettings ? JSON.stringify(tNode.aiSettings) : null,
      status: "EMPTY",
    })
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
    edgeRepo.insert({
      from_node_id: src.id,
      to_node_id: tgt.id,
      type: e.type as any,
    })
  }

  return {
    appliedAt: new Date().toISOString(),
    updatedNodeCount: analysis.updatedNodes.length,
    newNodeCount: analysis.newNodes.length,
    newEdgeCount: analysis.newEdges.length,
  }
}
