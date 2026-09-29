/**
 * A for-each loop's own content: how many iterations it had when it last ran.
 * Its children's state is not here — each iteration has its own rows in
 * `plan_node_states`, at `<loop path>/<loop id>:<index>`.
 */
export interface ForEachNodeContent {
  length?: number
}

/** How many iterations a loop had when it last ran, from its content; 0 when unreadable. */
export function loopLength(content: string | null | undefined): number {
  try {
    const length = (JSON.parse(content || "{}") as ForEachNodeContent).length
    return typeof length === "number" && length > 0 ? length : 0
  } catch {
    return 0
  }
}
