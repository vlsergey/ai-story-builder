import type { Database } from "better-sqlite3"

/**
 * The parallel loop folds back into the for-each. A for-each runs the
 * iterations that do not read each other side by side anyway, so all a
 * parallel loop still did its own way was naming its iterations: by a prefix
 * of their element's hash, where a for-each counts them. Every parallel loop
 * becomes a for-each, and every row in one of its iterations moves from the
 * element's key to the element's position — to each of its positions, for an
 * element listed twice, since a for-each writes such an element twice. An
 * iteration whose element the loop no longer lists goes, as the loop's next
 * run would drop it.
 *
 * Data the migration does not like is never a reason to fail — a throw would
 * roll back and the project would not open — so an anomaly is a warning
 * naming the project and the node.
 *
 * Frozen on purpose: raw SQL, no imports from the app. The layouts below are
 * those of version 34 and must not follow later code.
 */

interface StateRow {
  node_id: number
  path: string
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

/** A parallel loop's content as version 34 wrote it: the key of each element, in list order. */
function orderOf(content: string | null, unreadable: () => void): string[] {
  if (content === null || content === "") return []
  try {
    const order = (JSON.parse(content) as { order?: unknown }).order
    if (Array.isArray(order) && order.every((key) => typeof key === "string")) return order
  } catch {
    // falls through to the warning
  }
  unreadable()
  return []
}

export default function migration(db: Database): void {
  const project = db.name
  const warn = (message: string) => console.warn(`[migration 035] ${project}: ${message}`)

  const loops = db.prepare("SELECT id, title FROM plan_nodes WHERE type = 'parallel'").all() as {
    id: number
    title: string
  }[]
  if (loops.length === 0) return
  const parallel = new Set(loops.map((loop) => loop.id))

  // What each run of each loop listed, by the loop and the path it ran at.
  const at = (loopId: number, path: string) => `${loopId}@${path}`
  const orders = new Map<string, string[]>()
  for (const loop of loops) {
    const runs = db.prepare("SELECT path, content FROM plan_node_states WHERE node_id = ?").all(loop.id) as {
      path: string
      content: string | null
    }[]
    for (const { path, content } of runs) {
      const unreadable = () => warn(`«${loop.title}» (#${loop.id}) at "${path}": unreadable content; it lists nothing`)
      orders.set(at(loop.id, path), orderOf(content, unreadable))
    }
  }

  /**
   * Where a row at `path` goes: in every parallel loop on the way, to each
   * position its key holds in that loop's list. None when a key is no longer
   * listed; the path itself when no parallel loop is on the way.
   */
  function destinations(path: string): string[] {
    if (path === "") return [path]
    let targets = [""]
    let walked = ""
    for (const segment of path.split("/")) {
      const colon = segment.indexOf(":")
      if (colon < 1) return [path]
      const containerId = Number(segment.slice(0, colon))
      const key = segment.slice(colon + 1)
      const keys = parallel.has(containerId)
        ? (orders.get(at(containerId, walked)) ?? []).flatMap((listed, index) =>
            listed === key ? [String(index)] : [],
          )
        : [key]
      targets = targets.flatMap((prefix) =>
        keys.map((k) => (prefix === "" ? `${containerId}:${k}` : `${prefix}/${containerId}:${k}`)),
      )
      if (targets.length === 0) return []
      walked = walked === "" ? segment : `${walked}/${segment}`
    }
    return targets
  }

  const rows = db
    .prepare(
      `SELECT node_id, path, content, summary, status, word_count, char_count, byte_count,
              in_review, review_base_content, ai_improve_instruction
       FROM plan_node_states`,
    )
    .all() as StateRow[]

  const remove = db.prepare("DELETE FROM plan_node_states WHERE node_id = ? AND path = ?")
  const insert = db.prepare(
    `INSERT INTO plan_node_states (node_id, path, content, summary, status, word_count, char_count, byte_count,
                                   in_review, review_base_content, ai_improve_instruction, rev)
     VALUES (@node_id, @path, @content, @summary, @status, @word_count, @char_count, @byte_count,
             @in_review, @review_base_content, @ai_improve_instruction, lower(hex(randomblob(8))))`,
  )
  const rewrite = db.prepare(
    "UPDATE plan_node_states SET content = ?, rev = lower(hex(randomblob(8))) WHERE node_id = ? AND path = ?",
  )

  // Deletes first: a moved row may land where another one used to be.
  const moves: { row: StateRow; to: string[] }[] = []
  for (const row of rows) {
    // A loop now keeps how many elements it had, as a for-each does.
    const content = parallel.has(row.node_id)
      ? JSON.stringify({ length: orders.get(at(row.node_id, row.path))?.length ?? 0 })
      : row.content
    const to = destinations(row.path)
    if (to.length === 1 && to[0] === row.path) {
      if (content !== row.content) rewrite.run(content, row.node_id, row.path)
      continue
    }
    moves.push({ row: { ...row, content }, to })
    remove.run(row.node_id, row.path)
  }
  for (const { row, to } of moves) {
    for (const path of to) insert.run({ ...row, path })
  }

  db.prepare("UPDATE plan_nodes SET type = 'for-each' WHERE type = 'parallel'").run()
}
