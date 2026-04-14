import { AiThinkingPanelHandle } from "@/ai/AiThinkingPanel"
import { trpc } from "@/ipcClient"
import NodeEditor, { EditorMode } from "@/nodes/NodeEditor"
import { PlanNodeRow } from "@shared/plan-graph"
import { useCallback, useRef, useState } from "react"
import TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"
import { ResponseStreamEvent } from "openai/resources/responses/responses.js"

type StatusOverride = null | "GENERATING" | "IMPROVING"

export default function TextNodeEditor({
  initialValue,
  value,
  onSave: save,
  onChange,
  onExternalUpdate,
  status,
}: TypedPlanNodeEditorProps) {
  const nodeId = initialValue.id
  const [statusOverride, setStatusOverride] = useState<StatusOverride>(null)

  const [editorMode, setEditorMode] = useState<EditorMode>(
    initialValue.in_review === 1
      ? initialValue.ai_improve_instruction
        ? "review_after_improve"
        : "review_after_generate"
      : initialValue.content &&
          (initialValue.content as string).trim().length > 0 &&
          initialValue.ai_improve_instruction
        ? "improve"
        : "generate",
  )

  const acceptChangesMutation = trpc.plan.nodes.acceptReview.useMutation().mutateAsync

  const handleAcceptChanges = useCallback(async () => {
    await save(value)
    const newValue = await acceptChangesMutation(nodeId)
    onChange(newValue)
    setEditorMode((prevMode) => (prevMode === "review_after_generate" ? "generate" : "improve"))
  }, [acceptChangesMutation, onChange, nodeId, save, value])

  const aiThinkinPanelRef = useRef<AiThinkingPanelHandle>(null)
  const [tempContent, setTempContent] = useState<string | null>(null)

  const [generationStarted, setGenerationStarted] = useState(false)
  trpc.plan.nodes.aiGenerateWatchAndReview.useSubscription(
    { id: nodeId, options: { regenerateManual: true } },
    {
      enabled: generationStarted,
      onData: (event) => {
        switch (event.type) {
          case "event":
            const streamEvent = event.event as ResponseStreamEvent
            switch (streamEvent.type) {
              case "response.output_text.delta":
                setTempContent((content) => (content || "") + streamEvent.delta)
                break
              default:
                console.log(JSON.stringify(streamEvent))
                aiThinkinPanelRef?.current?.onEvent(streamEvent)
            }
            break
          case "data":
            onExternalUpdate(event.data)
            setTempContent(null)
            break
          case "completed":
            aiThinkinPanelRef?.current?.onComplete()
            setGenerationStarted(false)
            setTempContent(null)
            setStatusOverride(null)
            setEditorMode("review_after_generate")
            break
        }
      },
      onError: (err) => {
        console.error(err)
        aiThinkinPanelRef?.current?.onComplete()
        setTempContent(null)
        setGenerationStarted(false)
        setEditorMode("generate")
      },
    },
  )
  const handleGenerate = useCallback(() => {
    setStatusOverride("GENERATING")
    setGenerationStarted(true)
  }, [setGenerationStarted])

  const [improvingStarted, setImprovingStarted] = useState(false)
  trpc.plan.nodes.aiImprove.useSubscription(nodeId, {
    enabled: improvingStarted,
    onData: (event) => {
      switch (event.type) {
        case "event":
          const streamEvent = event.event as ResponseStreamEvent
          switch (streamEvent.type) {
            case "response.output_text.delta":
              setTempContent((content) => (content || "") + streamEvent.delta)
              break
            default:
              console.log(JSON.stringify(event.event))
              aiThinkinPanelRef?.current?.onEvent(streamEvent)
          }
          break
        case "data":
          onExternalUpdate(event.data)
          break
        case "completed":
          aiThinkinPanelRef?.current?.onComplete()
          setImprovingStarted(false)
          setEditorMode("review_after_improve")
          break
      }
    },
    onError: (err) => {
      console.error(err)
      aiThinkinPanelRef?.current?.onComplete()
      setImprovingStarted(false)
    },
  })

  const handleImprove = useCallback(() => {
    setStatusOverride("IMPROVING")
    setImprovingStarted(true)
  }, [setImprovingStarted])

  return (
    <NodeEditor<PlanNodeRow>
      aiThinkinPanelRef={aiThinkinPanelRef}
      editorMode={editorMode}
      onEditorModeChange={setEditorMode}
      onGenerate={handleGenerate}
      i18nPrefix="plan"
      onImprove={handleImprove}
      onAcceptChanges={handleAcceptChanges}
      onChange={onChange}
      status={statusOverride || status}
      value={{
        ...value,
        content: tempContent || value.content,
      }}
    />
  )
}
