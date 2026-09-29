import { ButtonGroup } from "@/ui-components/button-group"
import type { RegenerateStatusEvent, RunningLoop, RunningNode } from "@shared/RegenerateEvent"
import type { DockviewPanelApi } from "dockview"
import { PlayIcon, SquareIcon } from "lucide-react"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { trpc } from "../ipcClient"
import { useTranslation } from "react-i18next"
import AiThinkingPanel, { type AiThinkingPanelHandle } from "../ai/AiThinkingPanel"
import { Button } from "../ui-components/button"
import { Card } from "../ui-components/card"
import RegenerateOptionsForm from "./RegenerateOptionsForm"
import { dispatchOpenPlanNodeEditor } from "../lib/plan-graph-events"
import {
  type FollowedStreams,
  followStreams,
  NO_STREAMS,
  pruneStreams,
  runningKeyOf,
  streamKeyOf,
} from "./followed-stream"
import { useIterationSelection } from "./iteration-selection"
import ResponseStreamWatcher from "./ResponseStreamWatcher"

export default function RegenerationPanel({ panelApi }: { panelApi: DockviewPanelApi }) {
  const { t } = useTranslation()
  const { labelOf } = useIterationSelection()
  const [event, setEvent] = useState<RegenerateStatusEvent | null>(null)

  useEffect(() => {
    panelApi.setTitle(t("regeneration.title"))
  }, [panelApi, t])

  trpc.plan.nodes.aiGenerate.subscribeToStatusEvents.useSubscription(undefined, {
    onData: setEvent,
  })

  // Three-phase live view per LLM call: "Запрос отправлен" → thinking → streaming.
  // Transitions are one-way per call (mid-stream reasoning events do not flip
  // back to thinking — text is the more important signal); next response.created
  // resets the cycle. Inactive between calls / on stop.
  type Mode = "idle" | "dispatched" | "thinking" | "streaming"
  const [mode, setMode] = useState<Mode>("idle")
  const aiThinkingPanelRef = useRef<AiThinkingPanelHandle>(null)
  // Several branches of a parallel loop stream at once: the panel follows one
  // of them, as the stream watcher does, and ignores the others.
  const streams = useRef<FollowedStreams>(NO_STREAMS)
  const runningNodes = useMemo(
    () => new Set((event?.running ?? []).map(({ node }) => runningKeyOf(node.id, node.path))),
    [event],
  )
  useEffect(() => {
    streams.current = pruneStreams(streams.current, runningNodes)
  }, [runningNodes])
  trpc.plan.nodes.aiGenerate.subscribeToResponseStreamEvents.useSubscription(undefined, {
    onData(streamEvent) {
      const { event } = streamEvent
      const before = streams.current.followed
      streams.current = followStreams(streams.current, streamEvent)
      if (streamKeyOf(streamEvent) !== streams.current.followed) return
      if (before !== streams.current.followed) aiThinkingPanelRef.current?.onComplete()
      if (event.type === "response.created") {
        setMode("dispatched")
        aiThinkingPanelRef.current?.onComplete()
        return
      }
      if (event.type === "response.output_text.delta") {
        setMode("streaming")
        return
      }
      if (
        event.type === "response.output_item.added" ||
        event.type === "response.output_item.done" ||
        event.type === "response.reasoning_summary_text.delta"
      ) {
        setMode((m) => (m === "streaming" ? m : "thinking"))
        aiThinkingPanelRef.current?.onEvent(event as ResponseStreamEvent)
      }
    },
  })

  // Reset to idle when batch regeneration stops (inProcess flips true → false).
  const prevInProcessRef = useRef(false)
  useEffect(() => {
    const nowInProcess = event?.inProcess ?? false
    if (prevInProcessRef.current && !nowInProcess) {
      setMode("idle")
      aiThinkingPanelRef.current?.onComplete()
    }
    prevInProcessRef.current = nowInProcess
  }, [event?.inProcess])

  const startMutation = trpc.plan.nodes.aiGenerate.startForAll.useMutation()
  const stopMutation = trpc.plan.nodes.aiGenerate.stop.useMutation()

  const handleStart = useCallback(() => {
    console.info("[RegenerationPanel] startMutation")
    startMutation.mutateAsync()
  }, [])

  const renderRunning = () => {
    if (!event?.running?.length && !event?.loops?.length) return null
    return (
      <div className="mt-4">
        <div className="text-xs text-muted-foreground mb-2">{t("regeneration.current_nodes")}</div>
        <div className="space-y-1">
          {event.loops.map((loop) => (
            <div key={`loop ${runningKeyOf(loop.node.id, loop.node.path)}`} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary/30"></div>
              <RunningLoopLine loop={loop} />
            </div>
          ))}
          {event.running.map((item) => (
            <div key={runningKeyOf(item.node.id, item.node.path)} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary/60"></div>
              <RunningNodeLine item={item} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Функция для отображения ошибки
  const renderError = () => {
    if (!event?.firstError) return null
    const errorString = String(event.firstError)
    const at = event.firstErrorAt
    return (
      <Card className="mt-4 p-3 bg-destructive/10 border-destructive/30">
        <div className="text-xs font-semibold text-destructive mb-1">
          {t("regeneration.error")}
          {at && (
            // Opens the node in the iteration that failed.
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => dispatchOpenPlanNodeEditor({ id: at.nodeId, title: at.title }, at.path)}
            >
              «{at.title}»{at.path ? ` ${labelOf(at.path)}` : ""}
            </button>
          )}
        </div>
        <pre className="text-xs text-destructive whitespace-pre-wrap break-words">{errorString}</pre>
      </Card>
    )
  }

  // Функция для отображения статистики
  const renderStats = () => {
    if (!event) return null
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{t("regeneration.new")}</span>
            <span className="font-mono font-semibold text-green-600">{event.generatedNew}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{t("regeneration.same")}</span>
            <span className="font-mono font-semibold text-blue-600">{event.generatedSame}</span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{t("regeneration.empty")}</span>
            <span className="font-mono font-semibold text-yellow-600">{event.generatedEmpty}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{t("regeneration.skipped")}</span>
            <span className="font-mono font-semibold text-gray-600">{event.skipped}</span>
          </div>
        </div>
      </div>
    )
  }

  const [showOptionsForm, setShowOptionsForm] = useState(false)

  return (
    <div className="flex flex-col gap-2 p-2 h-full overflow-y-auto">
      <RegenerateOptionsForm show={showOptionsForm} onShowChange={setShowOptionsForm} />
      <ButtonGroup className="shrink-0 w-full">
        <Button variant="secondary" onClick={handleStart} disabled={event?.inProcess || startMutation.isPending}>
          <PlayIcon />
          {t("regeneration.start")}
        </Button>
        <Button
          variant="destructive"
          onClick={() => stopMutation.mutateAsync()}
          disabled={!event?.inProcess || stopMutation.isPending}
        >
          <SquareIcon />
          {t("regeneration.stop")}
        </Button>
      </ButtonGroup>
      {!event ? (
        <p className="text-muted-foreground text-sm">{t("regeneration.no_data")}</p>
      ) : event.inProcess ? (
        <div className="space-y-4">
          {renderStats()}
          {renderRunning()}
          {renderError()}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">{t("regeneration.idle")}</p>
          {event.firstError != null && renderError()}
          {renderStats()}
        </div>
      )}
      {event?.inProcess && mode === "dispatched" && (
        <p className="shrink-0 text-xs text-muted-foreground animate-pulse">{t("regeneration.dispatched")}</p>
      )}
      {/*
        Both panels stay mounted regardless of `mode` so their tRPC subscriptions
        (ResponseStreamWatcher) and accumulated state (AiThinkingPanel) keep
        up with events that arrive while they're not currently displayed.
        CSS-level hiding is intentional — re-mounting would miss early deltas.
      */}
      <div className={mode === "thinking" ? "shrink-0" : "hidden"}>
        <AiThinkingPanel ref={aiThinkingPanelRef} className="text-muted-foreground" />
      </div>
      <div className={mode === "streaming" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <ResponseStreamWatcher className="flex-1 min-h-0 text-muted-foreground text-xs" running={runningNodes} />
      </div>
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
