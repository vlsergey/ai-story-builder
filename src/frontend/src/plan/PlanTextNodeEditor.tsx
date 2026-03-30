import AiThinkingPanel, { AiThinkingPanelHandle } from "@/ai/AiThinkingPanel";
import { trpc } from "@/ipcClient";
import getDifference from "@/lib/getDifference";
import NodeEditor, { EditorMode, NodeEditorState } from "@/nodes/NodeEditor"
import { PlanNodeRow } from "@shared/plan-graph"
import { useCallback, useRef, useState } from "react"
import { useDebouncedCallback } from 'use-debounce';

interface PlanNodeTextEditorProps {
  nodeId: number,
  initialValue: PlanNodeRow
}

export default function PlanNodeTextEditor({ initialValue, nodeId }: PlanNodeTextEditorProps) {
  const [firstInitialValue, _] = useState<PlanNodeRow>(initialValue)
  const [lastSaved, setLastSaved] = useState<PlanNodeRow>(initialValue)
  const [value, setValue] = useState<PlanNodeRow>(initialValue)
  const [status, setStatus] = useState<NodeEditorState>('SAVED')

  const [editorMode, setEditorMode] = useState<EditorMode>(
    firstInitialValue.in_review === 1
      ? firstInitialValue.ai_improve_instruction ? 'review_after_improve' : 'review_after_generate'
      : firstInitialValue.content && (firstInitialValue.content as string).trim().length > 0 && firstInitialValue.ai_improve_instruction
      ? 'improve'
      : 'generate'
  )

  const patchMutation = trpc.plan.nodes.patch.useMutation().mutateAsync

  const save = useCallback(async (manual: boolean, value: PlanNodeRow) => {
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

  const debounceSave = useDebouncedCallback(save, 1000)

  const acceptChangesMutation = trpc.plan.nodes.acceptReview.useMutation().mutateAsync

  const handleAcceptChanges = useCallback(async () => {
    setStatus('SAVING')
    debounceSave.cancel()
    await save(true, value)
    setStatus('SAVING')
    const newValue = await acceptChangesMutation(nodeId)
    setLastSaved(newValue)
    setValue(newValue)
    setEditorMode((prevMode) => prevMode === 'review_after_generate' ? 'generate' : 'improve')
    setStatus('SAVED')
  }, [acceptChangesMutation, debounceSave, nodeId, save, value])

  const handleChange = useCallback((value: PlanNodeRow) => {
    setValue(value)
    setStatus('DEBOUNCE')
    debounceSave(true, value)
  }, [setValue, setStatus, debounceSave])

  const aiThinkinPanelRef = useRef<AiThinkingPanelHandle>(null)
  const [tempContent, setTempContent] = useState<string|null>(null)

  const [generationStarted, setGenerationStarted] = useState(false)
  trpc.plan.nodes.aiGenerate.useSubscription( nodeId, {
    enabled: generationStarted,
    onData: (event) => {
      switch (event.type) {
        case 'event': 
          const streamingEvent = event.event
          switch(streamingEvent.type) {
            case 'response.output_text.delta':
              setTempContent((content) => (content || '') + streamingEvent.delta)
              break
            default:
              console.log( JSON.stringify(event.event) )
              aiThinkinPanelRef?.current?.onEvent(event.event)
          }
          break
        case 'data':
          setLastSaved(event.data)
          setValue(event.data)
          setTempContent(null)
          break
        case 'completed':
          aiThinkinPanelRef?.current?.onComplete()
          setGenerationStarted(false)
          setTempContent(null)
          setStatus('SAVED')
          setEditorMode('review_after_generate')
          break
      }
    },
    onError: (err) => {
      console.error(err);
      aiThinkinPanelRef?.current?.onComplete()
      setTempContent(null)
      setGenerationStarted(false);
      setEditorMode('generate')
      setStatus('ERROR')
    }
  })
  const handleGenerate = useCallback(() => {
    setStatus('GENERATING')
    setGenerationStarted(true)
  }, [setGenerationStarted])

  const [improvingStarted, setImprovingStarted] = useState(false)
  trpc.plan.nodes.aiImprove.useSubscription( nodeId, {
    enabled: improvingStarted,
    onData: (event) => {
      switch (event.type) {
        case 'event': 
          const streamingEvent = event.event
          switch(streamingEvent.type) {
            case 'response.output_text.delta':
              setTempContent((content) => (content || '') + streamingEvent.delta)
              break
            default:
              console.log( JSON.stringify(event.event) )
              aiThinkinPanelRef?.current?.onEvent(event.event)
          }
          break
        case 'data':
          setLastSaved(event.data)
          setValue(event.data)
          break
        case 'completed':
          aiThinkinPanelRef?.current?.onComplete()
          setImprovingStarted(false)
          setEditorMode('review_after_improve')
          break
      }
    },
    onError: (err) => {
      console.error(err);
      aiThinkinPanelRef?.current?.onComplete()
      setImprovingStarted(false);
    }
  })

  const handleImprove = useCallback(() => {
    setStatus('IMPROVING')
    setImprovingStarted(true)
  }, [setImprovingStarted])

  return <NodeEditor<PlanNodeRow>
    aiThinkinPanelRef={aiThinkinPanelRef}
    editorMode={editorMode}
    onEditorModeChange={setEditorMode}
    onGenerate={handleGenerate}
    i18nPrefix="plan"
    onImprove={handleImprove}
    onAcceptChanges={handleAcceptChanges}
    onChange={handleChange}
    status={status}
    value={{
      ...value,
      content: tempContent || value.content
    }}
  />
}
