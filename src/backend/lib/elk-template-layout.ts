import ELK, { type ElkExtendedEdge, type ElkNode, type LayoutOptions } from "elkjs/lib/elk.bundled.js"
import type { ProjectTemplate, TemplateProjectPlanNode } from "../../shared/project-template.js"

/**
 * ELK layered layout for project templates. Used by `scripts/layout-templates.ts`
 * to write coordinates back into JSON, and by templates-structure tests to
 * assert that the coordinates in a bundled template match what the layout
 * would produce — i.e. that the template author didn't forget to run
 * `npm run layout-templates` after a structural change.
 *
 * Layout options must match `src/frontend/src/plan/plan-graph/hierarchical-layout.ts`.
 */

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

export interface ComputedNodePosition {
  x: number
  y: number
  width: number
  height: number
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

function resolveSource(sourceTitle: string, targetParentTitle: string | null, flat: FlatEntry[]): string | undefined {
  const sibling = flat.find((e) => e.title === sourceTitle && e.parentTitle === targetParentTitle)
  if (sibling) return sibling.id
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

/**
 * Run ELK layered layout on a template's plan graph. Returns a map from each
 * node's TITLE to its computed x/y/width/height (rounded to integers).
 *
 * Titles are used as the public key because templates don't carry IDs. Within
 * a single template they're globally unique except for the exempt
 * for-each-input/output internals, which this function returns under their
 * own (possibly repeating) titles — the caller can disambiguate by parent if
 * needed.
 */
export async function computeTemplateLayout(template: ProjectTemplate): Promise<Map<string, ComputedNodePosition>> {
  const flat: FlatEntry[] = []
  walk(template.plan?.nodes, null, null, flat, { n: 0 })

  const edges: ElkExtendedEdge[] = []
  let edgeCounter = 0
  for (const entry of flat) {
    for (const input of entry.ref.inputs ?? []) {
      const sourceId = resolveSource(input.sourceNodeTitle, entry.parentTitle, flat)
      if (!sourceId) {
        throw new Error(
          `Cannot resolve input "${input.sourceNodeTitle}" referenced by "${entry.title}" while laying out template.`,
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
  const resultById = new Map(flatElkResults(laidOut.children ?? []).map((r) => [r.id, r]))

  const result = new Map<string, ComputedNodePosition>()
  for (const entry of flat) {
    const res = resultById.get(entry.id)
    if (!res) continue
    result.set(entry.id, {
      x: Math.round(res.x ?? 0),
      y: Math.round(res.y ?? 0),
      width: res.width != null ? Math.round(res.width) : (entry.ref.width ?? DEFAULT_WIDTH),
      height: res.height != null ? Math.round(res.height) : (entry.ref.height ?? DEFAULT_HEIGHT),
    })
  }
  return result
}

/**
 * Convenience: returns a flat array of expected positions paired with the
 * original template node, so callers can compare against the stored x/y/w/h.
 */
export async function computeTemplateLayoutWithEntries(
  template: ProjectTemplate,
): Promise<Array<{ node: TemplateProjectPlanNode; expected: ComputedNodePosition }>> {
  const flat: FlatEntry[] = []
  walk(template.plan?.nodes, null, null, flat, { n: 0 })
  const positions = await computeTemplateLayout(template)
  return flat.map((entry) => ({
    node: entry.ref,
    expected: positions.get(entry.id) ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  }))
}
