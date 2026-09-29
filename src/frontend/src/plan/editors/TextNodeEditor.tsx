import type { AiThinkingPanelHandle } from "@/ai/AiThinkingPanel"
import { trpc } from "@/ipcClient"
import useAlert from "@/native/useAlert"
import NodeEditor, { type EditorMode } from "@/nodes/NodeEditor"
import type { PlanNodeRow } from "@shared/plan-graph"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"

type StatusOverride = null | "GENERATING" | "IMPROVING"

// NodeEditor was designed around lore-style row columns (ai_user_prompt /
// ai_system_prompt). For plan nodes the prompts now live inside
// node_type_settings JSON. We adapt the value in/out here so NodeEditor's
// shape stays unchanged for any future lore revival.
type EditorValue = PlanNodeRow & {
  ai_user_prompt: string | null
  ai_system_prompt: string | null
}

function readPrompts(nodeTypeSettings: string | null): { userPrompt: string | null; systemPrompt: string | null } {
  if (!nodeTypeSettings) return { userPrompt: null, systemPrompt: null }
  try {
    const parsed = JSON.parse(nodeTypeSettings) as { userPrompt?: unknown; systemPrompt?: unknown }
    return {
      userPrompt: typeof parsed.userPrompt === "string" ? parsed.userPrompt : null,
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : null,
    }
  } catch {
    return { userPrompt: null, systemPrompt: null }
  }
}

function writePrompts(
  nodeTypeSettings: string | null,
  userPrompt: string | null,
  systemPrompt: string | null,
): string | null {
  let base: Record<string, unknown> = {}
  if (nodeTypeSettings) {
    try {
      const parsed = JSON.parse(nodeTypeSettings)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      }
    } catch {
      // ignore, start fresh
    }
  }
  if (userPrompt) base.userPrompt = userPrompt
  else delete base.userPrompt
  if (systemPrompt) base.systemPrompt = systemPrompt
  else delete base.systemPrompt
  return Object.keys(base).length > 0 ? JSON.stringify(base) : null
}

export default function TextNodeEditor({
  disabled,
  iterationMissing,
  initialValue,
  value,
  onSave: save,
  onChange,
  onExternalUpdate,
  status,
}: TypedPlanNodeEditorProps) {
  const { t } = useTranslation()
  const alert = useAlert()
  const nodeId = initialValue.id
  // The iteration this editor is bound to; every action acts there.
  const path = initialValue.path
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
    const newValue = await acceptChangesMutation({ id: nodeId, path })
    onChange(newValue)
    setEditorMode((prevMode) => (prevMode === "review_after_generate" ? "generate" : "improve"))
  }, [onChange, nodeId, path, save, value])

  const aiThinkinPanelRef = useRef<AiThinkingPanelHandle>(null)
  /** The text as the model streams it: shown in place of the content, never saved as it. */
  const [tempContent, setTempContent] = useState<string | null>(null)
  // A new row landed — the streamed text is now the content, or was dropped.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on every new revision
  useEffect(() => setTempContent(null), [value.rev])

  trpc.plan.nodes.aiGenerate.subscribeToResponseStreamEvents.useSubscription(undefined, {
    onData({ nodeId: eventNodeId, path: eventPath, event }) {
      // Another iteration of the same node streams separately.
      if (eventNodeId !== nodeId || eventPath !== path) return
      if (event.type === "response.output_text.delta") {
        setTempContent((content) => (content || "") + event.delta)
      }
      aiThinkinPanelRef?.current?.onEvent(event as ResponseStreamEvent)
    },
  })

  const generateForNode = trpc.plan.nodes.aiGenerateAndReview.useMutation()
  const handleGenerate = useCallback(async () => {
    setStatusOverride("GENERATING")
    try {
      const newNodeVersion = await generateForNode.mutateAsync({ id: nodeId, path })
      aiThinkinPanelRef?.current?.onComplete()
      setTempContent(null)
      onExternalUpdate(newNodeVersion)
      setStatusOverride(null)
      setEditorMode("review_after_generate")
    } catch (err) {
      console.error(err)
      aiThinkinPanelRef?.current?.onComplete()
      setTempContent(null)
      setStatusOverride(null)
      setEditorMode("generate")
      alert(t("PlanNodeEditor.regenerationProblem.message", { error: `${(err as Error).message ?? err}` }))
    }
  }, [alert, nodeId, path, onExternalUpdate, t])

  const [improvingStarted, setImprovingStarted] = useState(false)
  trpc.plan.nodes.aiImprove.useSubscription(
    { id: nodeId, path },
    {
      enabled: improvingStarted,
      onData: (event) => {
        switch (event.type) {
          case "event": {
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
          }
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
        setStatusOverride(null)
        setTempContent(null)
        alert(t("PlanNodeEditor.improveProblem.message", { error: err.message }))
      },
    },
  )

  const handleImprove = useCallback(() => {
    setStatusOverride("IMPROVING")
    setImprovingStarted(true)
  }, [])

  const editorValue = useMemo<EditorValue>(() => {
    const { userPrompt, systemPrompt } = readPrompts(value.node_type_settings)
    return {
      ...value,
      content: tempContent || value.content,
      ai_user_prompt: userPrompt,
      ai_system_prompt: systemPrompt,
    }
  }, [value, tempContent])

  const handleEditorChange = useCallback(
    (edited: EditorValue) => {
      const { ai_user_prompt, ai_system_prompt, ...rest } = edited
      const nextSettings = writePrompts(rest.node_type_settings, ai_user_prompt, ai_system_prompt)
      // What is on screen while the model streams is its draft, not the content.
      const content = tempContent !== null ? value.content : rest.content
      onChange({ ...(rest as PlanNodeRow), content, node_type_settings: nextSettings })
    },
    [onChange, tempContent, value.content],
  )

  return (
    <NodeEditor<EditorValue>
      aiThinkinPanelRef={aiThinkinPanelRef}
      editorMode={editorMode}
      onEditorModeChange={setEditorMode}
      onGenerate={handleGenerate}
      i18nPrefix="plan"
      onImprove={handleImprove}
      onAcceptChanges={handleAcceptChanges}
      onChange={handleEditorChange}
      readOnly={disabled || iterationMissing || tempContent !== null}
      status={statusOverride || status}
      value={editorValue}
    />
  )
}
