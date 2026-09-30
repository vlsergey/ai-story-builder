import type { RunningLoop, RunningNode } from "@shared/RegenerateEvent"
import { useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AiThinkingItems } from "@/ai/AiThinkingPanel"
import { trpc } from "@/ipcClient"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui-components/accordion"
import { useIterationSelection } from "./iteration-selection"
import {
  type NodeStream,
  NO_STREAMS,
  ofRunning,
  type RunningStreams,
  runningKeyOf,
  type StreamEvent,
  streamsAfter,
} from "./running-streams"

/**
 * What a run is doing now: the loops it is in, and every node being written —
 * each of them an accordion item holding what its model call thinks and
 * writes. Nodes written side by side stream side by side, each in its own item.
 *
 * The node that started first stays unfolded, so there is always a stream to
 * watch; folding it keeps the list folded until the user unfolds the first
 * node again. Any other node is unfolded or folded on its own, for as long as
 * it runs.
 *
 * Shows nothing while nothing runs, and is meant to stay mounted then: it
 * must not miss the first events of a call.
 */
export default function RunningNodes() {
  const { t } = useTranslation()
  const [running, setRunning] = useState<RunningNode[]>([])
  const [loops, setLoops] = useState<RunningLoop[]>([])
  const [streams, setStreams] = useState<RunningStreams>(NO_STREAMS)
  /** Whether the node that started first is kept unfolded. */
  const [follow, setFollow] = useState(true)
  /** The nodes the user unfolded or folded themselves, other than through the first one. */
  const [chosen, setChosen] = useState<Readonly<Record<string, boolean>>>({})

  trpc.plan.nodes.aiGenerate.subscribeToStatusEvents.useSubscription(undefined, {
    onData(event) {
      const keys = new Set(event.running.map(({ node }) => runningKeyOf(node.id, node.path)))
      setRunning(event.running)
      setLoops(event.loops)
      // What is kept for a node goes once the node is done: when it runs again, it starts anew.
      setStreams((streams) => ofRunning(streams, keys))
      setChosen((chosen) => ofRunning(chosen, keys))
    },
  })
  trpc.plan.nodes.aiGenerate.subscribeToResponseStreamEvents.useSubscription(undefined, {
    onData(streamEvent) {
      // The type inferred over IPC is the serialized one; the event is the engine's own.
      setStreams((streams) => streamsAfter(streams, streamEvent as StreamEvent))
    },
  })

  if (running.length === 0 && loops.length === 0) return null

  const keys = running.map(({ node }) => runningKeyOf(node.id, node.path))
  const unfolded = keys.filter((key, index) => chosen[key] ?? (index === 0 && follow))
  const toggled = (next: string[]) => {
    for (const [index, key] of keys.entries()) {
      const now = next.includes(key)
      if (now === unfolded.includes(key)) continue
      if (index === 0) {
        setFollow(now)
        setChosen(({ [key]: _, ...others }) => others)
      } else {
        setChosen((chosen) => ({ ...chosen, [key]: now }))
      }
    }
  }

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">{t("regeneration.current_nodes")}</div>
      <div className="space-y-1">
        {loops.map((loop) => (
          <div key={runningKeyOf(loop.node.id, loop.node.path)} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary/30"></div>
            <RunningLoopLine loop={loop} />
          </div>
        ))}
      </div>
      <Accordion type="multiple" value={unfolded} onValueChange={toggled}>
        {running.map((item, index) => (
          <AccordionItem key={keys[index]} value={keys[index]} className="not-last:border-b-0">
            <AccordionTrigger className="items-center gap-2 py-1 text-xs font-normal">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-2 h-2 shrink-0 rounded-full bg-primary/60"></span>
                <RunningNodeLine item={item} />
              </span>
            </AccordionTrigger>
            {/* The stylesheet keeps an item no lower than it was when unfolded; a stream gets lower when the next call starts. */}
            <AccordionContent className="min-h-0! pb-1 pl-4">
              <NodeStreamView stream={streams[keys[index]]} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}

/** A loop running its iterations: how many are done, of how many. */
function RunningLoopLine({ loop }: { loop: RunningLoop }) {
  const { labelOf } = useIterationSelection()
  return (
    <span>
      <span className="text-xs text-muted-foreground">
        {loop.node.title} (ID: {loop.node.id}
        {loop.node.path ? `, ${labelOf(loop.node.path)}` : ""}):{" "}
      </span>
      <span className="text-xs font-medium">{loop.done}</span>
      <span className="text-xs text-muted-foreground"> / {loop.total}</span>
    </span>
  )
}

/** A node being written: its title, its iteration, and — for a node that tries again — which try. */
function RunningNodeLine({ item }: { item: RunningNode }) {
  const { labelOf } = useIterationSelection()
  return (
    <span>
      <span className="text-xs font-medium truncate">{item.node.title}</span>
      <span className="text-xs text-muted-foreground">
        {" "}
        (ID: {item.node.id}
        {item.node.path ? `, ${labelOf(item.node.path)}` : ""})
      </span>
      {item.attempt && (
        <span className="text-xs text-muted-foreground">
          {" "}
          — {item.attempt.index + 1}
          {item.attempt.total ? ` / ${item.attempt.total}` : ""}
        </span>
      )}
    </span>
  )
}

/**
 * What the call a node makes now has shown: the request is out, then what the
 * model thinks, then the text — the text being the signal that matters most,
 * it replaces the thinking for the rest of the call.
 */
function NodeStreamView({ stream }: { stream: NodeStream | undefined }) {
  const { t } = useTranslation()
  if (stream?.text) return <StreamText text={stream.text} />
  if (stream?.thinking.some((item) => item.type !== "message")) return <AiThinkingItems items={stream.thinking} />
  return <p className="text-xs text-muted-foreground animate-pulse">{t("regeneration.dispatched")}</p>
}

/** The text a call writes. The view keeps to its end as it grows, until the user scrolls back to read. */
function StreamText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls as the text grows
  useLayoutEffect(() => {
    if (atEnd.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text])

  return (
    <div
      ref={ref}
      className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border px-2 py-1 text-xs text-muted-foreground"
      onScroll={({ currentTarget: view }) => {
        atEnd.current = view.scrollHeight - view.scrollTop - view.clientHeight < 16
      }}
    >
      {text}
    </div>
  )
}
