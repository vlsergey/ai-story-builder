import type { ResponseOutputItem, ResponseStreamEvent } from "openai/resources/responses/responses.js"
import { thinkingItems } from "@/ai/thinking-items"

/** One event of a model response being streamed: by a node, in one iteration, at one place in its content. */
export interface StreamEvent {
  nodeId: number
  path: string
  contentPath: (string | number)[]
  event: ResponseStreamEvent
}

/**
 * What the call a running node makes now has shown so far. A node makes its
 * calls one after another — fix-problems finds, then fixes — and every call
 * starts the display anew.
 */
export interface NodeStream {
  /** Where in the node's content the call writes. */
  call: string
  /** What the model thinks and looks up, by output index. */
  thinking: ResponseOutputItem[]
  text: string
  /** The call is over: the node's next event belongs to another call. */
  ended: boolean
}

/** The streams of the nodes running now, each under its node's `runningKeyOf`. */
export type RunningStreams = Readonly<Record<string, NodeStream>>

export const NO_STREAMS: RunningStreams = {}

/** A running node, in its iteration: `nodeId@path`. */
export const runningKeyOf = (nodeId: number, path: string) => `${nodeId}@${path}`

const ENDS = new Set(["response.completed", "response.failed", "response.incomplete", "error"])

/** The streams after `streamEvent`: each node keeps its own, however many of them write at once. */
export function streamsAfter(streams: RunningStreams, streamEvent: StreamEvent): RunningStreams {
  const { nodeId, path, contentPath, event } = streamEvent
  const key = runningKeyOf(nodeId, path)
  const known = streams[key]
  if (ENDS.has(event.type)) return known ? { ...streams, [key]: { ...known, ended: true } } : streams
  const call = contentPath.join(".")
  // Not every engine announces a call with `response.created`: an event after
  // an ended call, or one written elsewhere, belongs to a new call as well.
  const stream =
    known && !known.ended && known.call === call && event.type !== "response.created"
      ? known
      : { call, thinking: [], text: "", ended: false }
  return {
    ...streams,
    [key]: {
      ...stream,
      thinking: thinkingItems(stream.thinking, event),
      text: event.type === "response.output_text.delta" ? stream.text + event.delta : stream.text,
    },
  }
}

/** The entries of `record` whose nodes still run: what is kept for a running node goes with it. */
export function ofRunning<T>(
  record: Readonly<Record<string, T>>,
  running: ReadonlySet<string>,
): Readonly<Record<string, T>> {
  const kept = Object.entries(record).filter(([key]) => running.has(key))
  return kept.length === Object.keys(record).length ? record : Object.fromEntries(kept)
}
