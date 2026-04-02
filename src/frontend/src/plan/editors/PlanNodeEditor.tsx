import { FC, useCallback, useEffect, useState } from 'react'
import { trpc } from '../../ipcClient'
import {NodeTypeEditors} from './NodeTypeEditors'
import { PlanNodeRow } from '@shared/plan-graph'
import getDifference from '@/lib/getDifference'
import { useDebouncedCallback } from 'use-debounce'
import TypedPlanNodeEditorProps from './TypedPlanNodeEditorProps'

export interface PlanNodeEditorProps {
  nodeId: number
  panelApi: { setTitle: (title: string) => void }
}

export default function PlanNodeEditor({ nodeId, panelApi }: PlanNodeEditorProps) {
  const planNodeQuery = trpc.plan.nodes.get.useQuery(nodeId)
  const node = planNodeQuery.data

  useEffect(() => {
    if (node?.title) {
      panelApi.setTitle(node?.title || '')
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

  return <div className="h-full overflow-auto">
    <PlanNodeEditorWrapper Editor={NodeTypeEditor} initialValue={node} />
  </div>
}

export type PlanNodeEditorState = 'DEBOUNCE' | 'ERROR' | 'SAVING' | 'SAVED'

interface PlanNodeEditorWrapperProps {
  initialValue: PlanNodeRow,
  Editor: FC<TypedPlanNodeEditorProps>
}

const PlanNodeEditorWrapper = ({ Editor, initialValue } : PlanNodeEditorWrapperProps) => {
  const nodeId = initialValue.id
  const [firstInitialValue] = useState<PlanNodeRow>(initialValue)
  const [value, setValue] = useState<PlanNodeRow>(initialValue)
  const [status, setStatus] = useState<PlanNodeEditorState>('SAVED')
  const [lastSaved, setLastSaved] = useState<PlanNodeRow>(initialValue)

  const patchMutation = trpc.plan.nodes.patch.useMutation().mutateAsync

  const saveImpl = useCallback(async (manual: boolean, value: PlanNodeRow) => {
    setStatus('SAVING')

    const diff = getDifference(lastSaved, value)
    if (Object.keys(diff).length === 0) {
      setStatus('SAVED')
      return
    }

    const newValue = await patchMutation({id: nodeId, manual, data: diff})
    setLastSaved(newValue)
    setStatus('SAVED')
  }, [lastSaved, nodeId, patchMutation, setLastSaved, setStatus])

  const debounceSave = useDebouncedCallback(saveImpl, 1000)

  const handleChange = useCallback((value: PlanNodeRow) => {
    setValue(value)
    setStatus('DEBOUNCE')
    debounceSave(true, value)
  }, [setValue, setStatus, debounceSave])

  const handleExternalUpdate = useCallback((value: PlanNodeRow) => {
    setLastSaved(value)
    setValue(value)
  }, [setLastSaved, setValue])

  const handleSave = useCallback(async (value: PlanNodeRow) => {
    setStatus('SAVING')
    setValue(value)
    debounceSave.cancel()
    await saveImpl(true, value)
    setStatus('SAVED')
}, [debounceSave, saveImpl])

  return <Editor
    initialValue={firstInitialValue}
    value={value}
    onChange={handleChange}
    onExternalUpdate={handleExternalUpdate}
    save={handleSave}
    status={status} />
}
