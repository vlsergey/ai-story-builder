import fs from "node:fs"
import path from "node:path"
import electron from "electron"
import type { ProjectCreateOptions } from "../../shared/project-create-options.js"
import type { ProjectTemplate } from "../../shared/project-template.js"
import { openProjectDatabase } from "../db/index.js"
import {
  getCurrentDbPath,
  getDataDir,
  isOpen,
  readAppSettings,
  setCurrentDbPath,
  writeAppSettings,
} from "../db/state.js"
import { setVerboseLogging } from "../lib/ai-logging.js"
import { sanitizeProjectName } from "../lib/project-name.js"
import { LoreNodeRepository } from "../lore/lore-node-repository.js"
import { PlanEdgeRepository } from "../plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "../plan/nodes/plan-node-repository.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import type { ProjectInitialData } from "../types/index.js"

const { shell } = electron

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

function getProjectInitialData(dbPath: string): ProjectInitialData {
  // SettingsRepository uses the current project, which should already be set via setCurrentDbPath
  try {
    const layout = SettingsRepository.getLayout()
    const projectTitle = SettingsRepository.getProjectTitle()
    return { layout, projectTitle }
  } catch (e) {
    console.warn("[getProjectInitialData] failed to read initial data from", dbPath, (e as Error).message)
    return { layout: null, projectTitle: null }
  }
}

/** Reads runtime flags (e.g. verbose_ai_logging) from the project DB and applies them. */
export function applyRuntimeSettings(dbPath: string): void {
  try {
    const verbose = SettingsRepository.getVerboseAiLogging()
    setVerboseLogging(verbose)
  } catch {
    // non-fatal — leave current flag value unchanged
  }
}

function updateRecent(dbPath: string): void {
  const s = readAppSettings()
  s.recent = s.recent || []
  s.recent = [dbPath].concat(s.recent.filter((x) => x !== dbPath)).slice(0, 10)
  writeAppSettings(s)
}

export function getProjectStatus(): { isOpen: boolean; path: string | null } {
  return { isOpen: isOpen(), path: getCurrentDbPath() }
}

export function closeProject(): { ok: boolean } {
  setCurrentDbPath(null)
  return { ok: true }
}

export function openProject(dbPath: string): { path: string; layout: unknown; projectTitle: string | null } {
  if (!dbPath) throw makeError("path required", 400)

  if (!fs.existsSync(dbPath)) {
    throw makeError("database file not found", 404)
  }

  try {
    const db = openProjectDatabase(dbPath) // runs any pending migrations
    db.close() // close the migration connection

    // Now set the current project so repositories can work
    setCurrentDbPath(dbPath)

    // Auto-create root plan node if none exist
    const planRepo = new PlanNodeRepository()
    const planCount = planRepo.count()
    if (planCount === 0) {
      const rootTitle = SettingsRepository.getProjectTitle() ?? "Plan"
      planRepo.insert({ title: rootTitle, parent_id: null, position: 0 })
    }
  } catch (e) {
    console.error(e)
    throw makeError(`failed to open database: ${String(e)}`, 500)
  }

  applyRuntimeSettings(dbPath)
  updateRecent(dbPath)
  return { path: dbPath, ...getProjectInitialData(dbPath) }
}

export function getRecentProjects(): string[] {
  const s = readAppSettings()
  return s.recent || []
}

export function deleteRecentProject(p: string): { ok: boolean } {
  if (!p) throw makeError("path required", 400)
  const s = readAppSettings()
  s.recent = (s.recent || []).filter((x) => x !== p)
  writeAppSettings(s)
  return { ok: true }
}

export function listProjectFiles(): { dir: string; files: string[] } {
  const projectsDir = path.join(getDataDir(), "projects")
  if (!fs.existsSync(projectsDir)) return { dir: projectsDir, files: [] }
  const files = fs
    .readdirSync(projectsDir)
    .filter((f) => f.endsWith(".sqlite") || f.endsWith(".db"))
    .map((f) => path.join(projectsDir, f))
  return { dir: projectsDir, files }
}

function importProjectFromTemplate(templatePath: string): void {
  if (!fs.existsSync(templatePath)) {
    throw makeError(`Template file not found: ${templatePath}`, 404)
  }
  const templateData = JSON.parse(fs.readFileSync(templatePath, "utf8")) as ProjectTemplate

  const planRepo = new PlanNodeRepository()
  const edgeRepo = new PlanEdgeRepository()
  const loreRepo = new LoreNodeRepository()

  // Map old node ID -> new node ID
  const nodeIdMap = new Map<number, number>()

  // Recursive function to create plan nodes
  function createPlanNodes(nodes: any[], parentId: number | null = null): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const { id, title, type, aiUserInstructions, nodeTypeSettings, children, inputs } = node

      // Insert node with position based on index
      const insertedId = planRepo.insert({
        title,
        type,
        parent_id: parentId,
        position: i,
        ai_user_prompt: aiUserInstructions ? aiUserInstructions.join("\n") : null,
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
  if (templateData.plan?.nodes) {
    createPlanNodes(templateData.plan.nodes, null)
  }

  // Create edges based on inputs
  if (templateData.plan?.nodes) {
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

    const allNodes = flattenNodes(templateData.plan.nodes)
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
  if (templateData.lore?.nodes) {
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

    createLoreNodes(templateData.lore.nodes, null)
  }
}

export function createProject({ title, templatePath }: ProjectCreateOptions): {
  path: string
  layout: unknown
  projectTitle: string | null
  reused?: boolean
} {
  const safeName = sanitizeProjectName(title)
  const projectsDir = path.join(getDataDir(), "projects")
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
    if (templatePath) {
      importProjectFromTemplate(templatePath)
    }

    SettingsRepository.setProjectTitle(title)

    updateRecent(dbPath)

    return { path: dbPath, layout: null, projectTitle: title }
  } catch (e) {
    throw makeError(String(e), 500)
  }
}
