/**
 * Where a node's state lives. `''` outside loops, then one `containerId:key`
 * segment per enclosing loop: `'27:2'` is iteration 2 of loop #27,
 * `'27:2/40:0'` one level deeper. A `for-each` keys its iterations by index;
 * a parallel loop will key them by a content hash, so a key is a string.
 * Only a loop builds its children's paths; nothing else concatenates them.
 */
export type NodePath = string

export const ROOT_PATH: NodePath = ""

export interface PathSegment {
  containerId: number
  key: string
}

export function parsePath(path: NodePath): PathSegment[] {
  if (path === ROOT_PATH) return []
  return path.split("/").map((segment) => {
    const colon = segment.indexOf(":")
    const containerId = Number(segment.slice(0, colon))
    const key = segment.slice(colon + 1)
    if (colon < 1 || !Number.isInteger(containerId) || key.length === 0) {
      throw new Error(`Malformed node path "${path}"`)
    }
    return { containerId, key }
  })
}

export function formatPath(segments: PathSegment[]): NodePath {
  return segments.map((s) => `${s.containerId}:${s.key}`).join("/")
}

/** The path of the children of loop `containerId` at `path`, in iteration `key`. */
export function childPath(path: NodePath, containerId: number, key: string | number): NodePath {
  const segment = `${containerId}:${key}`
  return path === ROOT_PATH ? segment : `${path}/${segment}`
}

/** The path one loop out: where the loop that holds this path lives. */
export function parentPath(path: NodePath): NodePath {
  const slash = path.lastIndexOf("/")
  return slash < 0 ? ROOT_PATH : path.slice(0, slash)
}

/** Number of enclosing loops. */
export function pathDepth(path: NodePath): number {
  return path === ROOT_PATH ? 0 : path.split("/").length
}

/** The first `depth` segments: where a node `depth` loops deep reads from this path. */
export function truncatePath(path: NodePath, depth: number): NodePath {
  if (depth <= 0) return ROOT_PATH
  return path.split("/").slice(0, depth).join("/")
}

export function lastSegment(path: NodePath): PathSegment | null {
  const segments = parsePath(path)
  return segments.length === 0 ? null : segments[segments.length - 1]
}

/** Whether `path` is `ancestor` itself or lies inside one of its iterations. */
export function isAtOrBelow(path: NodePath, ancestor: NodePath): boolean {
  if (ancestor === ROOT_PATH) return true
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

/**
 * SQL for "`column` is at or below the bound ancestor", with its parameters.
 * `'0'` is the character after `'/'`, so the range uses the index and needs no
 * LIKE — and `'27:20'` is not taken for a child of `'27:2'`.
 */
export function atOrBelowSql(column: string, ancestor: NodePath): { sql: string; params: string[] } {
  if (ancestor === ROOT_PATH) return { sql: "1", params: [] }
  return {
    sql: `(${column} = ? OR (${column} >= ? AND ${column} < ?))`,
    params: [ancestor, `${ancestor}/`, `${ancestor}0`],
  }
}
