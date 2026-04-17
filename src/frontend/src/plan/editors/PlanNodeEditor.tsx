import getDifference from "@/lib/getDifference"
import { Alert, AlertDescription, AlertTitle } from "@/ui-components/alert"
import type { PlanNodeRow } from "@shared/plan-graph"
import type { RegenerateOptions } from "@shared/RegenerateOptions"
import { type FC, useCallback, useEffect, useMemo, useState } from "react"
import { ErrorBoundary, type FallbackProps } from "react-error-boundary"
import { useDebouncedCallback } from "use-debounce"
import { trpc } from "../../ipcClient"
import { NodeTypeEditors } from "./NodeTypeEditors"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"
import { CircleAlertIcon } from "lucide-react"
import useAlert from "@/native/useAlert"

export interface PlanNodeEditorProps {
  nodeId: number
  panelApi: { setTitle: (title: string) => void }
}

export default function PlanNodeEditor({ nodeId, panelApi }: PlanNodeEditorProps) {
  const planNodeQuery = trpc.plan.nodes.getById.useQuery(nodeId)
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
        <PlanNodeEditorWrapper Editor={NodeTypeEditor} initialValue={node} />
      </ErrorBoundary>
    </div>
  )
}

export type PlanNodeEditorState = "DEBOUNCE" | "ERROR" | "SAVING" | "SAVED"

interface PlanNodeEditorWrapperProps {
  initialValue: PlanNodeRow
  Editor: FC<TypedPlanNodeEditorProps>
}

const PlanNodeEditorWrapper = ({ Editor, initialValue }: PlanNodeEditorWrapperProps) => {
  const nodeId = initialValue.id
  const [firstInitialValue] = useState<PlanNodeRow>(initialValue)
  const [value, setValue] = useState<PlanNodeRow>(initialValue)
  const [status, setStatus] = useState<PlanNodeEditorState>("SAVED")
  const [lastSaved, setLastSaved] = useState<PlanNodeRow>(initialValue)

  const patchMutation = trpc.plan.nodes.patch.useMutation().mutateAsync

  const saveImpl = useCallback(
    async (manual: boolean, valueToSave: PlanNodeRow) => {
      setStatus("SAVING")

      const diff = getDifference(lastSaved, valueToSave)
      if (Object.keys(diff).length === 0) {
        setStatus("SAVED")
        return
      }

      const newValue = await patchMutation({ id: nodeId, manual, data: diff })
      setLastSaved(newValue)

      // Check on-backend changes (such as status and updated timestamps)
      // and apply them to value
      const diffBetweenLastSavedAndCurrent = getDifference(lastSaved, newValue)
      setValue((value) => ({ ...value, ...diffBetweenLastSavedAndCurrent }))

      setStatus("SAVED")
    },
    [lastSaved, nodeId, patchMutation],
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

  const regenerateMutation = trpc.plan.nodes.aiGenerateOnly.useMutation()
  const alert = useAlert()

  const handleRegenerate = useCallback(
    async (options: RegenerateOptions) => {
      try {
        await handleSave(value)
        const result = await regenerateMutation.mutateAsync({ id: value.id, options })
        setLastSaved(result)
        setValue(result)
      } catch (e) {
        console.error(e)
        alert(`Node regeneration problem: ${e}`)
      }
    },
    [alert, regenerateMutation, handleSave, value],
  )

  return (
    <Editor
      dbValue={lastSaved}
      disabled={regenerateMutation.isPending}
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
