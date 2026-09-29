/** One model response being streamed: a node, in one iteration, at one place in its content. */
export interface StreamEvent {
  nodeId: number
  path: string
  contentPath: (string | number)[]
  /** An OpenAI response stream event, as it comes over IPC. */
  event: { type: string }
}

/**
 * The streams of a run, and which one is followed. Branches of a parallel loop
 * stream at the same time; each keeps its own text, and the display follows
 * the one that started first until it ends — it does not jump to every new
 * stream, nor glue two of them together.
 */
export interface FollowedStreams {
  texts: Record<string, string>
  /** Streams still writing, in the order they started. */
  active: string[]
  followed: string | null
}

export const NO_STREAMS: FollowedStreams = { texts: {}, active: [], followed: null }

export const streamKeyOf = ({ nodeId, path, contentPath }: Omit<StreamEvent, "event">) =>
  `${nodeId}@${path}#${contentPath.join(".")}`

const ENDS = new Set(["response.completed", "response.failed", "response.incomplete", "error"])

export function followStreams(state: FollowedStreams, streamEvent: StreamEvent): FollowedStreams {
  const key = streamKeyOf(streamEvent)
  const { event } = streamEvent
  let { texts, active, followed } = state
  if (!active.includes(key) && !ENDS.has(event.type)) {
    // A stream that starts while nothing writes begins a new stretch of the run.
    if (active.length === 0) texts = {}
    texts = { ...texts, [key]: "" }
    active = [...active, key]
  }
  if (event.type === "response.output_text.delta") {
    texts = { ...texts, [key]: (texts[key] ?? "") + String((event as { delta?: unknown }).delta ?? "") }
  }
  if (ENDS.has(event.type)) active = active.filter((k) => k !== key)
  if (followed === null || (!active.includes(followed) && active.length > 0)) followed = active[0] ?? followed
  return { texts, active, followed }
}

/** A running node as `pruneStreams` matches it: `nodeId@path`. */
export const runningKeyOf = (nodeId: number, path: string) => `${nodeId}@${path}`

/**
 * Drops the streams of nodes that no longer run. A call that fails ends
 * without a closing event; without this its stream would stay followed.
 */
export function pruneStreams(state: FollowedStreams, running: ReadonlySet<string>): FollowedStreams {
  const active = state.active.filter((key) => running.has(key.slice(0, key.indexOf("#"))))
  if (active.length === state.active.length) return state
  const followed =
    state.followed !== null && !active.includes(state.followed) && active.length > 0 ? active[0] : state.followed
  return { ...state, active, followed }
}
