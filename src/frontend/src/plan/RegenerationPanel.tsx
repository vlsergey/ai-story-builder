import { ButtonGroup } from "@/ui-components/button-group"
import type { RegenerateStatusEvent } from "@shared/RegenerateEvent"
import type { DockviewPanelApi } from "dockview"
import { PlayIcon, SquareIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { trpc } from "../ipcClient"
import { useTranslation } from "react-i18next"
import { Button } from "../ui-components/button"
import { Card } from "../ui-components/card"
import RegenerateOptionsForm from "./RegenerateOptionsForm"
import { dispatchOpenPlanNodeEditor } from "../lib/plan-graph-events"
import { useIterationSelection } from "./iteration-selection"
import RunningNodes from "./RunningNodes"

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

  const startMutation = trpc.plan.nodes.aiGenerate.startForAll.useMutation()
  const stopMutation = trpc.plan.nodes.aiGenerate.stop.useMutation()

  const handleStart = useCallback(() => {
    console.info("[RegenerationPanel] startMutation")
    // A run that fails, or is stopped, rejects: the status shows why.
    startMutation.mutate()
  }, [])

  // The failure that ended the run, and the node it happened at.
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

  // What the run has done so far, by outcome.
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
          onClick={() => stopMutation.mutate()}
          disabled={!event?.inProcess || stopMutation.isPending}
        >
          <SquareIcon />
          {t("regeneration.stop")}
        </Button>
      </ButtonGroup>
      <div className="space-y-4">
        {!event && <p className="text-muted-foreground text-sm">{t("regeneration.no_data")}</p>}
        {event && !event.inProcess && <p className="text-muted-foreground text-sm">{t("regeneration.idle")}</p>}
        {event && !event.inProcess && renderError()}
        {renderStats()}
        {/* Mounted whatever the run does: see RunningNodes. */}
        <RunningNodes />
        {event?.inProcess && renderError()}
      </div>
    </div>
  )
}
