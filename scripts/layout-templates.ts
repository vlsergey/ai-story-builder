#!/usr/bin/env tsx
/**
 * Recompute x/y/width/height of every plan node in every bundled template by
 * running them through the same ELK "layered" layout the frontend uses. Writes
 * the results back to the template files in place.
 *
 * Run:    npx tsx scripts/layout-templates.ts [file.json [file.json ...]]
 * No args: processes every *.json under src/backend/resources/resources/templates/.
 *
 * Layout options here MUST match
 * src/frontend/src/plan/plan-graph/hierarchical-layout.ts.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ELK, { type ElkExtendedEdge, type ElkNode, type LayoutOptions } from "elkjs/lib/elk.bundled.js"
import type { ProjectTemplate, TemplateProjectPlanNode } from "../src/shared/project-template.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.resolve(__dirname, "../src/backend/resources/resources/templates")

const DEFAULT_WIDTH = 200
const DEFAULT_HEIGHT = 80
const ELK_SPACING_NODE_NODE = 100
const ELK_SPACING_NODE_NODE_BETWEEN_LAYERS = 80

const LAYOUT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.spacing.nodeNodeBetweenLayers": String(ELK_SPACING_NODE_NODE_BETWEEN_LAYERS),
  "elk.padding": "[top=100,left=40,bottom=60,right=40]",
  "elk.spacing.nodeNode": String(ELK_SPACING_NODE_NODE),
}

const INTERNAL_PLAN_NODE_TYPES = new Set<string>(["for-each-input", "for-each-output"])

interface FlatEntry {
  id: string
  title: string
  type: string
  parentId: string | null
  parentTitle: string | null
  ref: TemplateProjectPlanNode
}

function walk(
  nodes: TemplateProjectPlanNode[] | undefined,
  parentId: string | null,
  parentTitle: string | null,
  out: FlatEntry[],
  counter: { n: number },
): void {
  if (!nodes) return
  for (const node of nodes) {
    const id = `n${counter.n++}`
    out.push({ id, title: node.title, type: node.type, parentId, parentTitle, ref: node })
    walk(node.children, id, node.title, out, counter)
  }
}

function resolveSource(
  sourceTitle: string,
  targetParentTitle: string | null,
  flat: FlatEntry[],
): string | undefined {
  // Sibling-first
  const sibling = flat.find((e) => e.title === sourceTitle && e.parentTitle === targetParentTitle)
  if (sibling) return sibling.id
  // Global (excluding internal types)
  const global = flat.find((e) => e.title === sourceTitle && !INTERNAL_PLAN_NODE_TYPES.has(e.type))
  return global?.id
}

function buildElkNode(entry: FlatEntry, flat: FlatEntry[]): ElkNode {
  const children = flat.filter((e) => e.parentId === entry.id).map((c) => buildElkNode(c, flat))
  return {
    id: entry.id,
    width: entry.ref.width ?? DEFAULT_WIDTH,
    height: entry.ref.height ?? DEFAULT_HEIGHT,
    children: children.length > 0 ? children : undefined,
    layoutOptions: LAYOUT_OPTIONS,
  }
}

function flatElkResults(elkNodes: ElkNode[]): ElkNode[] {
  return elkNodes.flatMap((n) => [n, ...(n.children ? flatElkResults(n.children) : [])])
}

async function layoutTemplate(filePath: string): Promise<{ moved: number; total: number }> {
  const raw = readFileSync(filePath, "utf8")
  const template = JSON.parse(raw) as ProjectTemplate

  const flat: FlatEntry[] = []
  walk(template.plan?.nodes, null, null, flat, { n: 0 })

  // Build edges. Includes only sibling-or-global resolvable references; unresolved
  // are flagged loudly because the structural test should already have caught them.
  const edges: ElkExtendedEdge[] = []
  let edgeCounter = 0
  for (const entry of flat) {
    for (const input of entry.ref.inputs ?? []) {
      const sourceId = resolveSource(input.sourceNodeTitle, entry.parentTitle, flat)
      if (!sourceId) {
        throw new Error(
          `Cannot resolve input "${input.sourceNodeTitle}" referenced by "${entry.title}" in ${path.basename(filePath)}`,
        )
      }
      edges.push({ id: `e${edgeCounter++}`, sources: [sourceId], targets: [entry.id] })
    }
  }

  const rootElkNodes = flat.filter((e) => e.parentId === null).map((e) => buildElkNode(e, flat))
  const graph: ElkNode = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: rootElkNodes,
    edges,
  }

  const elk = new ELK()
  const laidOut = await elk.layout(graph)
  const resultMap = new Map(flatElkResults(laidOut.children ?? []).map((r) => [r.id, r]))

  let moved = 0
  for (const entry of flat) {
    const res = resultMap.get(entry.id)
    if (!res) continue
    const newX = Math.round(res.x ?? 0)
    const newY = Math.round(res.y ?? 0)
    const newW = res.width != null ? Math.round(res.width) : entry.ref.width
    const newH = res.height != null ? Math.round(res.height) : entry.ref.height
    const oldX = entry.ref.x ?? 0
    const oldY = entry.ref.y ?? 0
    const oldW = entry.ref.width
    const oldH = entry.ref.height
    if (newX !== oldX || newY !== oldY || newW !== oldW || newH !== oldH) moved++
    entry.ref.x = newX
    entry.ref.y = newY
    if (newW != null) entry.ref.width = newW
    if (newH != null) entry.ref.height = newH
  }

  writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, "utf8")
  return { moved, total: flat.length }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const files = args.length > 0
    ? args.map((a) => path.resolve(process.cwd(), a))
    : readdirSync(TEMPLATES_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(TEMPLATES_DIR, f))

  if (files.length === 0) {
    console.warn("No templates found.")
    return
  }

  for (const file of files) {
    const { moved, total } = await layoutTemplate(file)
    console.log(`${path.relative(process.cwd(), file)} — ${moved}/${total} nodes updated`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
