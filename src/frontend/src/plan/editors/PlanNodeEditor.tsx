import useAlert from "@/native/useAlert"
import useConfirm from "@/native/useConfirm"
import { Alert, AlertDescription, AlertTitle } from "@/ui-components/alert"
import getDifference from "@shared/getDifference.js"
import type { PlanNodeRow } from "@shared/plan-graph"
import type { NodePath } from "@shared/plan-node-path"
import { CircleAlertIcon } from "lucide-react"
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ErrorBoundary, type FallbackProps } from "react-error-boundary"
import { useTranslation } from "react-i18next"
import { useDebouncedCallback } from "use-debounce"
import { trpc } from "../../ipcClient"
import { iterationLabel, useIterationSelection } from "../iteration-selection"
import { NodeTypeEditors } from "./NodeTypeEditors"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"

export interface PlanNodeEditorProps {
  nodeId: number
  /** The iteration the editor is bound to; without one, the iteration on display when it opened. */
  path?: NodePath
  panelApi: {
    setTitle: (title: string) => void
    updateParameters?: (params: Record<string, unknown>) => void
  }
}

export default function PlanNodeEditor({ nodeId, path: boundPath, panelApi }: PlanNodeEditorProps) {
  const { ready, displayPath } = useIterationSelection()
  // A tab from a layout saved before editors had a path opens at the
  // iteration on display, and remembers it from then on.
  const [resolvedPath, setResolvedPath] = useState<NodePath | undefined>(boundPath)
  useEffect(() => {
    if (resolvedPath === undefined && ready) setResolvedPath(displayPath(nodeId))
  }, [resolvedPath, ready, displayPath, nodeId])
  const path = boundPath ?? resolvedPath
  useEffect(() => {
    if (boundPath === undefined && path !== undefined) panelApi.updateParameters?.({ nodeId, path })
  }, [boundPath, path, nodeId, panelApi])

  const planNodeQuery = trpc.plan.nodes.getById.useQuery(
    { id: nodeId, path: path ?? "" },
    { enabled: path !== undefined },
  )
  const node = planNodeQuery.data

  useEffect(() => {
    if (node?.title) panelApi.setTitle(path ? `${node.title} ${iterationLabel(path)}` : node.title)
  }, [panelApi, node?.title, path])

  if (path === undefined || planNodeQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">Loading...</span>
      </div>
    )
  }

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-destructive text-sm">Node not found</span>
      </div>
    )
  }

  const NodeTypeEditor = NodeTypeEditors[node.type]
  if (!NodeTypeEditor) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-destructive text-sm">Node type not supported</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      {!node.current && <IterationGone />}
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <PlanNodeEditorWrapper
          Editor={NodeTypeEditor}
          initialValue={node}
          serverValue={node}
          iterationGone={!node.current}
        />
      </ErrorBoundary>
    </div>
  )
}

/** The loop no longer has the iteration this tab was opened on: nothing here can be saved. */
function IterationGone() {
  const { t } = useTranslation()
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{t("PlanNodeEditor.iterationGone.title")}</AlertTitle>
      <AlertDescription>{t("PlanNodeEditor.iterationGone.message")}</AlertDescription>
    </Alert>
  )
}

export type PlanNodeEditorState = "DEBOUNCE" | "ERROR" | "SAVING" | "SAVED"

interface PlanNodeEditorWrapperProps {
  initialValue: PlanNodeRow
  /** The row as the server has it now; adopted whenever the editor holds no unsaved edits. */
  serverValue: PlanNodeRow
  iterationGone: boolean
  Editor: FC<TypedPlanNodeEditorProps>
}

/** Fields that belong to the iteration rather than to the node: a save of them is checked against the revision. */
const STATE_FIELDS = new Set<string>([
  "content",
  "summary",
  "status",
  "in_review",
  "review_base_content",
  "ai_improve_instruction",
])

const PlanNodeEditorWrapper = ({ Editor, initialValue, serverValue, iterationGone }: PlanNodeEditorWrapperProps) => {
  const nodeId = initialValue.id
  const path = initialValue.path
  const [firstInitialValue] = useState<PlanNodeRow>(initialValue)
  const [value, setValue] = useState<PlanNodeRow>(initialValue)
  const [status, setStatus] = useState<PlanNodeEditorState>("SAVED")
  const [lastSaved, setLastSaved] = useState<PlanNodeRow>(initialValue)
  const { t } = useTranslation()
  const alert = useAlert()
  const confirm = useConfirm()
  const utils = trpc.useUtils()

  const patchMutation = trpc.plan.nodes.patch.useMutation().mutateAsync

  /** Records a row the server wrote, here and in the cache: the cache must not bring back an older row. */
  const remember = useCallback(
    (row: PlanNodeRow) => {
      setLastSaved(row)
      utils.plan.nodes.getById.setData({ id: nodeId, path }, (cached) => (cached ? { ...cached, ...row } : cached))
    },
    [nodeId, path, utils],
  )
  /** Shows a row the server wrote in place of what the editor holds. */
  const adopt = useCallback(
    (row: PlanNodeRow) => {
      remember(row)
      setValue(row)
    },
    [remember],
  )

  // A regeneration, a demotion or another editor wrote the row — its state or
  // its definition: show it, unless the user is in the middle of an edit.
  const seen = useRef(serverValue)
  useEffect(() => {
    if (serverValue === seen.current) return
    seen.current = serverValue
    if (status !== "SAVED") return
    const { current: _, ...server } = serverValue as PlanNodeRow & { current?: boolean }
    if (Object.keys(getDifference(lastSaved, server)).length === 0) return
    setLastSaved(server)
    setValue(server)
  }, [serverValue, status, lastSaved])

  const saveImpl = useCallback(
    async (manual: boolean, valueToSave: PlanNodeRow) => {
      if (iterationGone) {
        setStatus("ERROR")
        return
      }
      setStatus("SAVING")

      // What the user changed, relative to what the editor last had from the server.
      const diff: Partial<PlanNodeRow> = getDifference(lastSaved, valueToSave)
      delete diff.rev
      if (Object.keys(diff).length === 0) {
        setStatus("SAVED")
        return
      }
      const stateKeys = Object.keys(diff).filter((key) => STATE_FIELDS.has(key)) as (keyof PlanNodeRow)[]

      let base = lastSaved
      for (let attempt = 0; ; attempt++) {
        try {
          const newValue = await patchMutation({
            id: nodeId,
            path,
            manual,
            data: diff,
            rev: stateKeys.length > 0 ? base.rev : undefined,
          })
          // Check on-backend changes (such as status and counts) and apply them
          // to value, keeping whatever the user typed while this was saving.
          const diffBetweenLastSavedAndCurrent = getDifference(lastSaved, newValue)
          remember(newValue)
          setValue((value) => ({ ...value, ...diffBetweenLastSavedAndCurrent }))
          setStatus("SAVED")
          return
        } catch (e) {
          if ((e as { data?: { httpStatus?: number } }).data?.httpStatus !== 409 || attempt >= 2) {
            setStatus("ERROR")
            await alert(t("PlanNodeEditor.saveProblem.message", { error: `${(e as Error).message ?? e}` }))
            return
          }
        }
        // Something wrote this iteration since the editor read it. If it left
        // alone what the user changed, only statuses moved: save on top.
        // Otherwise the user decides whose version stays.
        let fresh = await utils.plan.nodes.getById.fetch({ id: nodeId, path })
        const collides = stateKeys.some((key) => fresh[key] !== base[key])
        if (collides) {
          if (!(await confirm("PlanNodeEditor.conflict.message"))) {
            adopt(fresh)
            setStatus("SAVED")
            return
          }
          // The dialog took a while: save over what is there now.
          fresh = await utils.plan.nodes.getById.fetch({ id: nodeId, path })
        }
        base = fresh
      }
    },
    [adopt, alert, confirm, iterationGone, lastSaved, nodeId, path, remember, t, utils],
  )

  const debounceSave = useDebouncedCallback(saveImpl, 1000)

  const handleChange = useCallback(
    (value: PlanNodeRow) => {
      setValue(value)
      setStatus("DEBOUNCE")
      debounceSave(true, value)
    },
    [debounceSave],
  )

  const handleExternalUpdate = useCallback((value: PlanNodeRow) => adopt(value), [adopt])

  const handleSave = useCallback(
    async (value: PlanNodeRow) => {
      setValue(value)
      debounceSave.cancel()
      await saveImpl(true, value)
    },
    [debounceSave, saveImpl],
  )

  const nodeTypeSettings = useMemo(() => {
    return JSON.parse(value.node_type_settings || "{}") || {}
  }, [value])

  const handleNodeTypeSettingsChange = useCallback(
    (nodeTypeSettings: any) => {
      handleChange({ ...value, node_type_settings: JSON.stringify(nodeTypeSettings) })
    },
    [value, handleChange],
  )

  const regenerateMutation = trpc.plan.nodes.aiGenerate.startForNode.useMutation()

  const handleRegenerate = useCallback(async () => {
    try {
      await handleSave(value)
      adopt(await regenerateMutation.mutateAsync({ nodeId: value.id, path: value.path }))
    } catch (e) {
      console.error(e)
      alert(t("PlanNodeEditor.regenerationProblem.message", { error: `${e}` }))
    }
  }, [adopt, alert, handleSave, t, value])

  return (
    <Editor
      dbValue={lastSaved}
      // While the iteration is being written, the text is the model's to write.
      disabled={iterationGone || regenerateMutation.isPending || lastSaved.status === "GENERATING"}
      initialValue={firstInitialValue}
      value={value}
      nodeTypeSettings={nodeTypeSettings}
      onNodeTypeSettingsChange={handleNodeTypeSettingsChange}
      onChange={handleChange}
      onExternalUpdate={handleExternalUpdate}
      onRegenerate={handleRegenerate}
      onSave={handleSave}
      status={status}
    />
  )
}

function ErrorFallback({ error }: FallbackProps) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Something wrong happens while rendering an editor</AlertTitle>
      <AlertDescription>{(error as any).message}</AlertDescription>
    </Alert>
  )
}
