import { useCallback, useEffect, useId, useState } from "react"
import { useLocale } from "../lib/locale"
import { trpc } from "../ipcClient"
import { Button } from "../ui-components/button"
import { Card } from "../ui-components/card"
import { DockviewPanelApi } from "dockview"
import { ButtonGroup } from "@/ui-components/button-group"
import { PlayIcon, SquareIcon } from "lucide-react"
import { useForm } from "react-hook-form"
import { RegenerateOptions } from "@shared/RegenerateOptions"
import { zodResolver } from "@hookform/resolvers/zod"
import RegenerateOptionsForm, { formSchema } from "./RegenerateOptionsForm"
import { RegenerateEvent } from "@shared/RegenerateEvent"

export default function RegenerationPanel({ panelApi }: { panelApi: DockviewPanelApi }) {
  const { t } = useLocale()
  const [event, setEvent] = useState<RegenerateEvent | null>(null)

  useEffect(() => {
    panelApi.setTitle(t("regeneration.title"))
  }, [panelApi, t])

  trpc.plan.nodes.regenerateTreeNodesContentsProgress.useSubscription(undefined, {
    onData: setEvent,
  })

  const startMutation = trpc.plan.nodes.regenerateTreeNodesContents.useMutation()
  const stopMutation = trpc.plan.nodes.regenerateTreeNodesContentsStop.useMutation()

  const regenerateOptionsForm = useForm<RegenerateOptions>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      regenerateManual: false,
    },
  })

  const handleStart = useCallback(
    (options: RegenerateOptions) => {
      console.info("[RegenerationPanel] startMutation", options)
      startMutation.mutateAsync(options)
    },
    [startMutation],
  )

  // Функция для форматирования стека текущих узлов
  const renderCurrentNodeStack = () => {
    if (!event?.currentNodeStack?.length) return null
    return (
      <div className="mt-4">
        <div className="text-xs text-muted-foreground mb-2">{t("regeneration.current_nodes")}</div>
        <div className="space-y-1">
          {event.currentNodeStack.map((node, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary/60"></div>
              <span className="text-xs font-medium truncate">{node.title}</span>
              <span className="text-xs text-muted-foreground">(ID: {node.id})</span>
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

  const statusBadge = () => {
    if (!event?.inProcess) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-muted text-muted-foreground">
          {t("regeneration.idle")}
        </span>
      )
    }
    if (event.stopping) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-destructive/20 text-destructive-foreground animate-pulse">
          {t("regeneration.stopping")}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-600">
        <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></div>
        {t("regeneration.in_progress")}
      </span>
    )
  }

  const formId = useId()

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      {/* Заголовок и статус */}
      <form id={formId} onSubmit={regenerateOptionsForm.handleSubmit(handleStart)}>
        <RegenerateOptionsForm form={regenerateOptionsForm} />
      </form>
      <ButtonGroup className="shrink-0 w-full">
        <Button variant="secondary" type="submit" form={formId} disabled={event?.inProcess || startMutation.isPending}>
          <PlayIcon />
          {t("regeneration.start")}
        </Button>
        <Button variant="destructive" onClick={() => {}} disabled={!event?.inProcess || stopMutation.isPending}>
          <SquareIcon />
          {t("regeneration.stop")}
        </Button>
      </ButtonGroup>
      {statusBadge()}
      {!event ? (
        <p className="text-muted-foreground text-sm">{t("regeneration.no_data")}</p>
      ) : event.inProcess ? (
        <div className="space-y-4">
          {renderStats()}
          {renderCurrentNodeStack()}
          {renderError()}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">{t("regeneration.idle")}</p>
          {event.firstError != null && renderError()}
          {renderStats()}
        </div>
      )}
    </div>
  )
}
