import { randomUUID } from "node:crypto"
import type { Database } from "better-sqlite3"

/**
 * Moves what nodes produced out of `plan_nodes` into `plan_node_states`, one
 * row per node and iteration of its loops.
 *
 * Until now a loop's children had one row each, holding the iteration on
 * display ("mounted"); the other iterations lived as snapshots inside the
 * loop's own content (`{currentIndex, length, overrides}`). Every iteration
 * now gets its own rows, at `<loop path>/<loop id>:<index>`, and the loop
 * keeps only `{"length": n}`.
 *
 * For the mounted iteration the live rows win over its snapshot: pages are
 * snapshotted only when the user pages away, and the rows are what everything
 * but the loop's output read. Data the migration does not like is never a
 * reason to fail — a throw would roll back and the project would not open —
 * so every anomaly is a warning naming the project and the node.
 *
 * Frozen on purpose: raw SQL, no imports from the app. The column lists and
 * rules below are those of version 32 and must not follow later code.
 */

interface NodeRow {
  id: number
  parent_id: number | null
  type: string
  title: string
  content: string | null
  summary: string | null
  status: string
  word_count: number
  char_count: number
  byte_count: number
  in_review: number
  review_base_content: string | null
  ai_improve_instruction: string | null
}

interface StateRow {
  content: string | null
  summary: string | null
  status: string
  word_count: number
  char_count: number
  byte_count: number
  in_review: number
  review_base_content: string | null
  ai_improve_instruction: string | null
}

/** A snapshot entry as `collectForEachNodeIterationContentFromChildren` wrote it. */
interface SnapshotEntry {
  content?: unknown
  summary?: unknown
  status?: unknown
  word_count?: unknown
  char_count?: unknown
  byte_count?: unknown
}

/** Where a level's state comes from: the live rows, or one snapshot of the loop above. */
type View = { live: true } | { live: false; entries: Record<string, SnapshotEntry> | null }

const LIVE: View = { live: true }

/** Columns of `plan_nodes` that were state; `ai_sync_info` goes too — nothing read it for plan nodes. */
const DROPPED_COLUMNS = [
  "content",
  "summary",
  "status",
  "word_count",
  "char_count",
  "byte_count",
  "in_review",
  "review_base_content",
  "ai_improve_instruction",
  "ai_sync_info",
] as const

/** Node types whose output is their content as it is; the others keep the counts they had. */
const TEXT_OUTPUT_TYPES = new Set([
  "text",
  "lore",
  "merge",
  "format",
  "for-each-input",
  "for-each-output",
  "for-each-index",
])

/** Statuses a changed input demotes, as the cascade of version 32 does. */
const DEMOTABLE = new Set(["GENERATED", "EMPTY"])

function counts(text: string): Pick<StateRow, "word_count" | "char_count" | "byte_count"> {
  const trimmed = text.trim()
  return {
    word_count: trimmed === "" ? 0 : trimmed.split(/\s+/).length,
    char_count: [...text].length,
    byte_count: Buffer.byteLength(text, "utf8"),
  }
}

function asCount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === "string" ? value : JSON.stringify(value)
}

function childPath(path: string, containerId: number, index: number): string {
  const segment = `${containerId}:${index}`
  return path === "" ? segment : `${path}/${segment}`
}

function isAtOrBelow(path: string, ancestor: string): boolean {
  return ancestor === "" || path === ancestor || path.startsWith(`${ancestor}/`)
}

interface LoopContent {
  length: number
  currentIndex: number
  overrides: unknown[]
}

export default function migration(db: Database): void {
  const project = db.name
  const warn = (message: string) => console.warn(`[migration 033] ${project}: ${message}`)

  const columns = (db.pragma("table_info(plan_nodes)") as { name: string }[]).map((c) => c.name)
  const hasStates = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_node_states'").get()
  if (hasStates && !columns.includes("content")) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_node_states (
      node_id INTEGER NOT NULL REFERENCES plan_nodes (id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      content TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'EMPTY',
      word_count INTEGER NOT NULL DEFAULT 0,
      char_count INTEGER NOT NULL DEFAULT 0,
      byte_count INTEGER NOT NULL DEFAULT 0,
      in_review INTEGER NOT NULL DEFAULT 0,
      review_base_content TEXT,
      ai_improve_instruction TEXT,
      rev TEXT NOT NULL DEFAULT (lower(hex(randomblob(8)))),
      PRIMARY KEY (node_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_plan_node_states_path ON plan_node_states (path);
    DELETE FROM plan_node_states;
  `)

  const nodes = db
    .prepare(
      `SELECT id, parent_id, type, title, content, summary, status, word_count, char_count, byte_count,
              in_review, review_base_content, ai_improve_instruction
       FROM plan_nodes ORDER BY position, id`,
    )
    .all() as NodeRow[]
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const childrenOf = new Map<number, NodeRow[]>()
  for (const node of nodes) {
    if (node.parent_id === null || !byId.has(node.parent_id)) continue
    const list = childrenOf.get(node.parent_id) ?? []
    list.push(node)
    childrenOf.set(node.parent_id, list)
  }
  const name = (node: NodeRow) => `node ${node.id} «${node.title}»`

  const states = new Map<string, { nodeId: number; path: string; state: StateRow }>()
  const key = (nodeId: number, path: string) => `${nodeId}@${path}`
  /** Loops whose output reached a reader from an iteration past their length, with the loop's path. */
  const phantomOutputs: { loop: NodeRow; path: string }[] = []
  const reviewCleared = new Set<number>()

  function parseLoop(node: NodeRow, content: string | null, path: string): LoopContent {
    let parsed: unknown = {}
    if (content) {
      try {
        parsed = JSON.parse(content)
      } catch {
        warn(`${name(node)} at "${path}": loop content is not JSON; it gets no iterations`)
        parsed = {}
      }
    }
    const record = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>
    const overrides = Array.isArray(record.overrides) ? record.overrides : []
    const length =
      typeof record.length === "number" && Number.isInteger(record.length) && record.length >= 0
        ? record.length
        : overrides.length
    const currentIndex =
      typeof record.currentIndex === "number" && Number.isInteger(record.currentIndex) ? record.currentIndex : 0
    return { length, currentIndex, overrides }
  }

  function stateOf(node: NodeRow, path: string, view: View): StateRow {
    let state: StateRow
    if (view.live) {
      state = {
        content: node.content,
        summary: node.summary,
        status: node.status,
        word_count: node.word_count,
        char_count: node.char_count,
        byte_count: node.byte_count,
        in_review: node.in_review,
        review_base_content: node.review_base_content,
        ai_improve_instruction: node.ai_improve_instruction,
      }
    } else {
      // As `applyForEachNodeIterationToChildren` mounted it: a child missing
      // from the snapshot is empty and waits to be generated.
      const entry = view.entries?.[`${node.id}`]
      const present = !!entry && typeof entry === "object"
      state = {
        content: present ? asText(entry.content) : null,
        summary: present ? asText(entry.summary) : null,
        status: present ? (typeof entry.status === "string" ? entry.status : "EMPTY") : "OUTDATED",
        word_count: present ? asCount(entry.word_count) : 0,
        char_count: present ? asCount(entry.char_count) : 0,
        byte_count: present ? asCount(entry.byte_count) : 0,
        in_review: 0,
        review_base_content: null,
        ai_improve_instruction: null,
      }
    }
    // A run was interrupted: what it was writing is still to be written.
    if (state.status === "GENERATING") state.status = "OUTDATED"
    if (TEXT_OUTPUT_TYPES.has(node.type)) state = { ...state, ...counts(state.content ?? "") }
    // Review fields were never snapshotted: on a loop child they may belong to
    // another iteration than the mounted one, and "reject" would restore that
    // iteration's text here.
    if (path !== "" && (state.in_review || state.review_base_content || state.ai_improve_instruction)) {
      if (!reviewCleared.has(node.id)) warn(`${name(node)} is inside a loop: its review was dropped`)
      reviewCleared.add(node.id)
      state = { ...state, in_review: 0, review_base_content: null, ai_improve_instruction: null }
    }
    return state
  }

  function walk(node: NodeRow, path: string, view: View): void {
    const state = stateOf(node, path, view)
    const children = childrenOf.get(node.id) ?? []

    if (node.type !== "for-each") {
      states.set(key(node.id, path), { nodeId: node.id, path, state })
      for (const child of children) walk(child, path, view)
      return
    }

    const loop = parseLoop(node, state.content, path)
    for (let i = 0; i < loop.length; i++) {
      const childView: View =
        view.live && i === loop.currentIndex
          ? LIVE
          : { live: false, entries: (loop.overrides[i] as Record<string, SnapshotEntry> | null | undefined) ?? null }
      for (const child of children) walk(child, childPath(path, node.id, i), childView)
    }

    // Iterations past the length are gone: the list got shorter. Until now the
    // loop's output still mapped over them.
    const output = children.find((c) => c.type === "for-each-output")
    let phantom = false
    for (let i = loop.length; i < loop.overrides.length; i++) {
      const entries = loop.overrides[i] as Record<string, SnapshotEntry> | null | undefined
      if (!entries) continue
      warn(`${name(node)} at "${path}": snapshot of iteration ${i} is past its length ${loop.length}; dropped`)
      const outputContent = output ? asText(entries[`${output.id}`]?.content) : null
      if (outputContent) phantom = true
    }
    // Children still showing an iteration past the length — a loop that never
    // ran shows iteration 0 of none, with nothing in it, and is no anomaly.
    const shownPastLength = children.some((c) => c.content !== null || c.status !== "EMPTY")
    if (view.live && loop.currentIndex >= loop.length && shownPastLength) {
      warn(`${name(node)} at "${path}": its children show iteration ${loop.currentIndex}, past its length; dropped`)
      if (output?.content) phantom = true
    }
    if (phantom) phantomOutputs.push({ loop: node, path })

    states.set(key(node.id, path), {
      nodeId: node.id,
      path,
      state: { ...state, content: JSON.stringify({ length: loop.length }) },
    })
  }

  for (const node of nodes) {
    if (node.parent_id === null) {
      walk(node, "", LIVE)
    } else if (!byId.has(node.parent_id)) {
      warn(`${name(node)}: its parent ${node.parent_id} does not exist; treated as a top-level node`)
      walk(node, "", LIVE)
    }
  }

  // Only direct children were ever snapshotted, and a demotion was mirrored
  // one level down: a nested child may still say GENERATED where its loop,
  // in that iteration, is known to be stale.
  for (const entry of states.values()) {
    const node = byId.get(entry.nodeId)
    if (!node || node.parent_id === null || entry.state.status !== "GENERATED") continue
    if (byId.get(node.parent_id)?.type !== "for-each") continue
    const slash = entry.path.lastIndexOf("/")
    if (slash < 0) continue
    const containerPath = entry.path.slice(0, slash)
    const container = states.get(key(node.parent_id, containerPath))
    if (container?.state.status === "OUTDATED") entry.state.status = "OUTDATED"
  }

  // A reader that took in the output of a vanished iteration holds text the
  // loop no longer produces: it and the loop run again.
  const edges = db.prepare("SELECT from_node_id, to_node_id FROM plan_edges").all() as {
    from_node_id: number
    to_node_id: number
  }[]
  for (const { loop, path } of phantomOutputs) {
    const self = states.get(key(loop.id, path))
    if (self && DEMOTABLE.has(self.state.status)) self.state.status = "OUTDATED"
    for (const edge of edges) {
      if (edge.from_node_id !== loop.id) continue
      for (const entry of states.values()) {
        if (entry.nodeId !== edge.to_node_id || !isAtOrBelow(entry.path, path)) continue
        if (DEMOTABLE.has(entry.state.status)) entry.state.status = "OUTDATED"
      }
    }
  }

  const insert = db.prepare(`
    INSERT INTO plan_node_states (node_id, path, content, summary, status, word_count, char_count, byte_count,
                                  in_review, review_base_content, ai_improve_instruction, rev)
    VALUES (@nodeId, @path, @content, @summary, @status, @word_count, @char_count, @byte_count,
            @in_review, @review_base_content, @ai_improve_instruction, @rev)
  `)
  for (const { nodeId, path, state } of states.values()) {
    insert.run({ nodeId, path, ...state, rev: randomUUID().slice(0, 13) })
  }

  // Loops around each node, outermost first, to check what the new model assumes.
  // A parent chain that loops back on itself is broken data; it must not hang
  // the migration, which would keep the project from opening.
  const loopsAround = (id: number): number[] => {
    const loops: number[] = []
    const seen = new Set<number>([id])
    for (let p = byId.get(id)?.parent_id ?? null; p !== null && !seen.has(p); p = byId.get(p)?.parent_id ?? null) {
      seen.add(p)
      const parent = byId.get(p)
      if (!parent) break
      if (parent.type === "for-each") loops.unshift(parent.id)
    }
    return loops
  }
  for (const node of nodes) {
    if (loopsAround(node.id).length > 0) continue
    if (!states.has(key(node.id, ""))) {
      warn(`${name(node)} has no state: it is outside any loop, or its own ancestor; it will be generated`)
    }
  }
  // Edges the engine now refuses to resolve: out of a loop past its output, or
  // across sibling loops. They read whichever iteration was mounted.
  for (const edge of edges) {
    const source = byId.get(edge.from_node_id)
    const target = byId.get(edge.to_node_id)
    if (!source || !target) continue
    const sourceLoops = loopsAround(source.id)
    const targetLoops = loopsAround(target.id)
    if (sourceLoops.some((loop, i) => targetLoops[i] !== loop)) {
      warn(`edge ${name(source)} → ${name(target)} leaves a loop past its output; generating ${name(target)} will fail`)
    }
  }

  for (const column of DROPPED_COLUMNS) {
    if (columns.includes(column)) db.exec(`ALTER TABLE plan_nodes DROP COLUMN ${column}`)
  }
}
