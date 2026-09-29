import useAlert from "@/native/useAlert"
import useConfirm from "@/native/useConfirm"
import { Alert, AlertDescription, AlertTitle } from "@/ui-components/alert"
import getDifference from "@shared/getDifference.js"
import type { PlanNodeRow } from "@shared/plan-graph"
import type { NodePath } from "@shared/plan-node-path"
import { CircleAlertIcon } from "lucide-react"
import { type FC, useCallback, useEffect, useMemo, useState } from "react"
import { ErrorBoundary, type FallbackProps } from "react-error-boundary"
import { useTranslation } from "react-i18next"
import { useDebouncedCallback } from "use-debounce"
import { trpc } from "../../ipcClient"
import { useIterationSelection } from "../iteration-selection"
import { NodeTypeEditors } from "./NodeTypeEditors"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"

export interface PlanNodeEditorProps {
  nodeId: number
  /** The iteration the editor is bound to; without one, the iteration on display when it opened. */
  path?: NodePath
  panelApi: { setTitle: (title: string) => void }
}

export default function PlanNodeEditor({ nodeId, path: boundPath, panelApi }: PlanNodeEditorProps) {
  const { displayPath } = useIterationSelection()
  const [path] = useState(() => boundPath ?? displayPath(nodeId))
  const planNodeQuery = trpc.plan.nodes.getById.useQuery({ id: nodeId, path })
  const node = planNodeQuery.data

  useEffect(() => {
    if (node?.title) {
      panelApi.setTitle(node?.title || "")
    }
  }, [panelApi, node?.title])

  if (planNodeQuery.isLoading) {
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
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <PlanNodeEditorWrapper Editor={NodeTypeEditor} initialValue={node} serverValue={node} />
      </ErrorBoundary>
    </div>
  )
}

export type PlanNodeEditorState = "DEBOUNCE" | "ERROR" | "SAVING" | "SAVED"

interface PlanNodeEditorWrapperProps {
  initialValue: PlanNodeRow
  /** The row as the server has it now; adopted whenever the editor holds no unsaved edits. */
  serverValue: PlanNodeRow
  Editor: FC<TypedPlanNodeEditorProps>
}

/** Fields that belong to the iteration rather than to the node: a save of them is checked against the revision. */
const STATE_FIELDS = new Set([
  "content",
  "summary",
  "status",
  "in_review",
  "review_base_content",
  "ai_improve_instruction",
])

const PlanNodeEditorWrapper = ({ Editor, initialValue, serverValue }: PlanNodeEditorWrapperProps) => {
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

  // A regeneration, a demotion or another editor wrote the row: show it,
  // unless the user is in the middle of an edit.
  useEffect(() => {
    if (status !== "SAVED" || serverValue.rev === lastSaved.rev) return
    setLastSaved(serverValue)
    setValue(serverValue)
  }, [serverValue, status, lastSaved.rev])

  const saveImpl = useCallback(
    async (manual: boolean, valueToSave: PlanNodeRow) => {
      setStatus("SAVING")

      // What the user changed, relative to what the editor last had from the server.
      const diff: Partial<PlanNodeRow> = getDifference(lastSaved, valueToSave)
      delete diff.rev
      if (Object.keys(diff).length === 0) {
        setStatus("SAVED")
        return
      }
      const touchesState = Object.keys(diff).some((key) => STATE_FIELDS.has(key))

      let rev: string | undefined = touchesState ? lastSaved.rev : undefined
      for (let attempt = 0; ; attempt++) {
        try {
          const newValue = await patchMutation({ id: nodeId, path, manual, data: diff, rev })
          // Check on-backend changes (such as status and counts) and apply them to value
          const diffBetweenLastSavedAndCurrent = getDifference(lastSaved, newValue)
          setLastSaved(newValue)
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
        // Something wrote this iteration since the editor read it. If its text
        // is still the one the editor saw, only statuses moved: save on top.
        // Otherwise the user decides whose text stays.
        const fresh = await utils.plan.nodes.getById.fetch({ id: nodeId, path })
        if (fresh.content !== lastSaved.content && !(await confirm("PlanNodeEditor.conflict.message"))) {
          setLastSaved(fresh)
          setValue(fresh)
          setStatus("SAVED")
          return
        }
        rev = fresh.rev
      }
    },
    [alert, confirm, lastSaved, nodeId, path, t, utils],
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

  const handleExternalUpdate = useCallback((value: PlanNodeRow) => {
    setLastSaved(value)
    setValue(value)
  }, [])

  const handleSave = useCallback(
    async (value: PlanNodeRow) => {
      setStatus("SAVING")
      setValue(value)
      debounceSave.cancel()
      await saveImpl(true, value)
      setStatus("SAVED")
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
      const result = await regenerateMutation.mutateAsync({ nodeId: value.id, path: value.path })
      setLastSaved(result)
      setValue(result)
    } catch (e) {
      console.error(e)
      alert(t("PlanNodeEditor.regenerationProblem.message", { error: `${e}` }))
    }
  }, [alert, handleSave, t, value])

  return (
    <Editor
      dbValue={lastSaved}
      // While the iteration is being written, the text is the model's to write.
      disabled={regenerateMutation.isPending || lastSaved.status === "GENERATING"}
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
