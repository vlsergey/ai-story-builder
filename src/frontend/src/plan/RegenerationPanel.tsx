import { ButtonGroup } from "@/ui-components/button-group"
import type {
  RegenerateStatusEvent,
  RegenerationStackItemIteration,
  RegenerationStackItemNode,
} from "@shared/RegenerateEvent"
import type { DockviewPanelApi } from "dockview"
import { PlayIcon, SquareIcon } from "lucide-react"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import { useCallback, useEffect, useRef, useState } from "react"
import { trpc } from "../ipcClient"
import { useTranslation } from "react-i18next"
import AiThinkingPanel, { type AiThinkingPanelHandle } from "../ai/AiThinkingPanel"
import { Button } from "../ui-components/button"
import { Card } from "../ui-components/card"
import RegenerateOptionsForm from "./RegenerateOptionsForm"
import ResponseStreamWatcher from "./ResponseStreamWatcher"

export default function RegenerationPanel({ panelApi }: { panelApi: DockviewPanelApi }) {
  const { t } = useTranslation()
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
  trpc.plan.nodes.aiGenerate.subscribeToResponseStreamEvents.useSubscription(undefined, {
    onData({ event }) {
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

  const renderCurrentRegenerationStack = () => {
    if (!event?.currentRegenerationStack?.length) return null
    return (
      <div className="mt-4">
        <div className="text-xs text-muted-foreground mb-2">{t("regeneration.current_nodes")}</div>
        <div className="space-y-1">
          {event.currentRegenerationStack.map((stackItem, idx, arr) => {
            const hasNext = arr.length > idx + 1
            const next = hasNext ? arr[idx + 1] : undefined

            // Do not displya container processing in stack if next stack item is container iteration processing
            if (stackItem.type === "node" && next?.type === "iteration" && next.container === stackItem.node) {
              return null
            }

            return (
              <div key={idx} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary/60"></div>
                {stackItem.type === "node" && <StackItemNode item={stackItem as RegenerationStackItemNode} />}
                {stackItem.type === "iteration" && (
                  <StackItemIteration item={stackItem as RegenerationStackItemIteration} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Функция для отображения ошибки
  const renderError = () => {
    if (!event?.firstError) return null
    const errorString = String(event.firstError)
    return (
      <Card className="mt-4 p-3 bg-destructive/10 border-destructive/30">
        <div className="text-xs font-semibold text-destructive mb-1">{t("regeneration.error")}</div>
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
          {renderCurrentRegenerationStack()}
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
        <ResponseStreamWatcher className="flex-1 min-h-0 text-muted-foreground text-xs" />
      </div>
    </div>
  )
}

function StackItemIteration({ item }: { item: RegenerationStackItemIteration }) {
  return (
    <span>
      <span className="text-xs text-muted-foreground">
        {item.container.title} (ID: {item.container.id}):{" "}
      </span>
      <span className="text-xs font-medium truncate">{item.zeroBasedIterationIndex + 1}</span>
      {item.totalIterations && <span className="text-xs text-muted-foreground"> / {item.totalIterations}</span>}
    </span>
  )
}

function StackItemNode({ item }: { item: RegenerationStackItemNode }) {
  return (
    <span>
      <span className="text-xs font-medium truncate">{item.node.title}</span>
      <span className="text-xs text-muted-foreground"> (ID: {item.node.id})</span>
    </span>
  )
}
