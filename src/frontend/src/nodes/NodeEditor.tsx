import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { EditorView } from "@codemirror/view"
import { useTheme } from "../lib/theme/theme-provider"
import { useEditorSettings } from "../settings/editor-settings"
import { useLocale } from "../lib/locale"
import DiffViewAndAccept from "./DiffViewAndAccept"
import type { AiGenerationSettings } from "../../../shared/ai-generation-settings"
import type { AiEngineSyncRecord } from "../types/models"
import { trpc } from "../ipcClient"
import { Button } from "../ui-components/button"
import AiGenerationSettingsForm from "../ai/AiGenerationSettingsForm"
import { Textarea } from "../ui-components/textarea"
import { Input } from "@/ui-components/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui-components/tabs"
import AiThinkingPanel, { type AiThinkingPanelHandle } from "@/ai/AiThinkingPanel"
import useConfirm from "@/native/useConfirm"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui-components/tooltip"
import { CircleQuestionMarkIcon } from "lucide-react"

export interface NodeSavedPayload {
  nodeId: number
  primaryValue?: string
  wordCount?: number
  charCount?: number
  byteCount?: number
  aiSyncInfo?: Record<string, AiEngineSyncRecord> | null
}

interface Node {
  title: string
  content: string | null
  ai_user_prompt: string | null
  ai_system_prompt: string | null
  ai_settings: string | null
  review_base_content: string | null
  ai_improve_instruction: string | null
}

export type NodeEditorState = "DEBOUNCE" | "ERROR" | "LOADING" | "SAVING" | "SAVED" | "GENERATING" | "IMPROVING"
export type EditorMode = "generate" | "review_after_generate" | "improve" | "review_after_improve"

interface NodeEditorProps<N extends Node> {
  aiThinkinPanelRef?: React.RefObject<AiThinkingPanelHandle | null>
  editorMode: EditorMode
  onEditorModeChange: (mode: EditorMode) => void
  i18nPrefix: string
  onAcceptChanges: () => Promise<void>
  onChange: (node: N) => void
  onGenerate: () => void
  onImprove: () => void
  status: NodeEditorState
  value: N
}

type DiffTab = "new" | "sidebyside" | "perlines"

export default function NodeEditor<N extends Node>({
  aiThinkinPanelRef,
  editorMode,
  i18nPrefix,
  value: node,
  status,
  onAcceptChanges,
  onChange,
  onEditorModeChange,
  onGenerate,
  onImprove,
}: NodeEditorProps<N>) {
  const { resolvedTheme } = useTheme()
  const { wordWrap } = useEditorSettings()
  const { t } = useLocale()
  const tp = useCallback((s: string) => t(`${i18nPrefix}.${s}`), [i18nPrefix, t])

  // ── Editor mode ────────────────────────────────────────────────────────────
  const [selectedTab, setSelectedTab] = useState<DiffTab>("new")

  // ── AI engine config ────────────────────────────────────────────────────────
  const currentAiEngine = trpc.settings.allAiEnginesConfig.currentEngine.get.useQuery().data || null
  const nodeAiGenerationSettings: Record<string, AiGenerationSettings> = useMemo(() => {
    return node.ai_settings ? (JSON.parse(node.ai_settings) as Record<string, AiGenerationSettings>) : {}
  }, [node])

  const onTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      onChange({ ...node, title: value })
    },
    [node, onChange],
  )

  const onReviewBaseContentChange = useCallback(
    (value: string) => {
      onChange({ ...node, review_base_content: value })
    },
    [node, onChange],
  )

  const onContentChange = useCallback(
    (value: string) => {
      onChange({ ...node, content: value })
    },
    [node, onChange],
  )

  const onNodeAiGenerationSettingsChange = useCallback(
    (newSettings: Record<string, AiGenerationSettings>) => {
      onChange({ ...node, ai_settings: JSON.stringify(newSettings) })
    },
    [node, onChange],
  )

  const aiGenerationSettings: AiGenerationSettings | null = currentAiEngine
    ? (nodeAiGenerationSettings[currentAiEngine] ?? null)
    : null
  const onAiGenerationSettingsChange = useCallback(
    async (value: AiGenerationSettings | null) => {
      if (!currentAiEngine) return
      const newNodeAiGenerationSettings = { ...nodeAiGenerationSettings }
      if (value == null) {
        delete newNodeAiGenerationSettings[currentAiEngine]
      } else {
        newNodeAiGenerationSettings[currentAiEngine] = value
      }
      onNodeAiGenerationSettingsChange(newNodeAiGenerationSettings)
    },
    [currentAiEngine, nodeAiGenerationSettings, onNodeAiGenerationSettingsChange],
  )

  // ── Mode A: Generate from scratch ─────────────────────────────────────────
  const confirm = useConfirm()
  const handleGenerate = useCallback(async () => {
    if (!node.ai_user_prompt) return
    if (node.content) {
      const confirmed = await confirm(`${i18nPrefix}.overwrite_warning`)
      if (!confirmed) return
    }
    onGenerate()
  }, [confirm, i18nPrefix, node, onGenerate])

  // ── Mode B→C or D→C: Improve with AI ──────────────────────────────────────
  const handleImprove = useCallback(async () => {
    if (!node.ai_improve_instruction) return
    setSelectedTab("new")
    onImprove()
  }, [node, onImprove])

  const hasContent = !!node.content

  const onAiUserPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...node, ai_user_prompt: e.currentTarget.value })
    },
    [onChange, node],
  )

  const onAiSystemPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...node, ai_system_prompt: e.currentTarget.value })
    },
    [onChange, node],
  )

  const onAiImproveInstructionsChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...node, ai_improve_instruction: e.currentTarget.value })
    },
    [onChange, node],
  )

  const inReview = editorMode === "review_after_generate" || editorMode === "review_after_improve"
  const codeMirrorRef = useRef<ReactCodeMirrorRef>(null)

  const handleScrollToBottom = useCallback(() => {
    const view = codeMirrorRef.current?.view
    if (view) {
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.doc.length, {
          y: "end",
        }),
      })
    }
  }, [])

  useEffect(() => {
    if ((node.content && status === "GENERATING") || status === "IMPROVING") {
      handleScrollToBottom()
    }
  }, [handleScrollToBottom, node.content, status])

  if (status === "LOADING") {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-4">
      <Tabs
        defaultValue="user"
        className={editorMode === "generate" ? "flex-1 w-full flex flex-col" : "flex-1 w-full flex flex-col hidden"}
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="system">
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1">
                {t("ai.systemInstructions")}
                <CircleQuestionMarkIcon />
              </TooltipTrigger>
              <TooltipContent>{t("ai.systemInstructions.description")}</TooltipContent>
            </Tooltip>
          </TabsTrigger>
          <TabsTrigger value="user">
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1">
                {t("ai.userInstructions")}
                <CircleQuestionMarkIcon />
              </TooltipTrigger>
              <TooltipContent>{t("ai.userInstructions.description")}</TooltipContent>
            </Tooltip>
          </TabsTrigger>
        </TabsList>
        <TabsContent className="flex-1 flex flex-col" value="system">
          <Textarea
            className="flex-1 basis-auto min-h-[50px] [field-sizing:fixed]! resize-y! overflow-auto"
            value={node.ai_system_prompt || ""}
            onChange={onAiSystemPromptChange}
            placeholder="System instructions (optional)"
          />
        </TabsContent>
        <TabsContent className="flex-1 flex flex-col" value="user">
          <Textarea
            className="flex-1 basis-auto min-h-[50px] [field-sizing:fixed]! resize-y! overflow-auto"
            value={node.ai_user_prompt || ""}
            onChange={onAiUserPromptChange}
            placeholder={tp("aiInstructions")}
          />
        </TabsContent>
      </Tabs>

      <div
        style={{
          maxHeight: editorMode === "review_after_improve" ? undefined : "0",
          transition: "max-height 0.3s ease-in-out",
          overflow: editorMode === "review_after_improve" ? undefined : "hidden",
        }}
      >
        <Textarea
          value={node.ai_improve_instruction || ""}
          onChange={onAiImproveInstructionsChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !(status === "GENERATING" || status === "IMPROVING")) {
              e.preventDefault()
              void handleImprove()
            }
          }}
          placeholder={tp("improve_placeholder")}
          disabled={status === "GENERATING" || status === "IMPROVING"}
          rows={2}
          className="w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <div className="flex item-center w-full shrink-0">
          <AiGenerationSettingsForm
            className="flex-grow"
            value={aiGenerationSettings}
            onChange={onAiGenerationSettingsChange}
          />
          <Button
            className="shrink-0 self-end"
            onClick={handleImprove}
            variant="secondary"
            disabled={status === "GENERATING" || status === "IMPROVING" || !node.ai_improve_instruction}
          >
            {status === "GENERATING" || status === "IMPROVING" ? "Generating…" : tp("repeat_improve")}
          </Button>
        </div>
      </div>

      {/* ── AI CONTROLS & GENERATE BUTTON — after prompts, mode 'generate' only ───── */}
      {editorMode === "generate" && (
        <div className="flex item-center w-full">
          <AiGenerationSettingsForm
            className="flex-grow"
            value={aiGenerationSettings}
            onChange={onAiGenerationSettingsChange}
          />
          <Button
            className="shrink-0 self-end m-4"
            variant="default"
            onClick={handleGenerate}
            disabled={status !== "SAVED"}
          >
            {status === "GENERATING" ? "Generating…" : hasContent ? tp("regenerate") : tp("generate")}
          </Button>
        </div>
      )}

      <AiThinkingPanel ref={aiThinkinPanelRef} />

      {/* ── PRIMARY FIELD — always visible ───────────────────────────────────── */}
      <div className="flex flex-row items-center gap-2 py-1.5 shrink-0">
        <Input
          className="flex-1"
          value={node.title}
          onChange={onTitleChange}
          placeholder={`Node title`}
          aria-label={`Node title`}
        />
        <span className="text-xs text-muted-foreground shrink-0">{status}</span>
      </div>

      {/* ── STATUS ROWS — always visible ────────────────────────────────────── */}
      {/* {generateMutation.isError && (
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0">
          Generation error: {String(generateMutation.error)}
        </div>
      )} */}

      <div
        style={{
          display: "grid",
          gridTemplateRows: inReview ? "1fr" : "0fr",
          transition: "grid-template-rows 300ms ease-in-out",
        }}
        className="shrink-0"
      >
        <div className="overflow-hidden min-h-0">
          <div className="flex border-b border-border">
            {(["new", "sidebyside", "perlines"] as DiffTab[]).map((tab) => (
              <button
                type="button"
                key={tab}
                onClick={() => setSelectedTab(tab)}
                className={`px-3 py-1.5 text-sm border-r border-border last:border-r-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedTab === tab
                    ? "bg-background text-foreground font-medium"
                    : "bg-muted text-muted-foreground hover:bg-background/70"
                }`}
              >
                {tab === "new" ? tp("tab_new") : tab === "sidebyside" ? tp("tab_sidebyside") : tp("tab_perlines")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── CONTENT AREA — flex-1 ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {(editorMode === "generate" || editorMode === "improve" || (inReview && selectedTab === "new")) && (
          <CodeMirror
            ref={codeMirrorRef}
            value={node.content || ""}
            height="100%"
            extensions={[markdown(), ...(wordWrap ? [EditorView.lineWrapping] : [])]}
            theme={resolvedTheme === "obsidian" ? "dark" : "light"}
            onChange={onContentChange}
            className="h-full w-full"
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: true }}
          />
        )}

        {/* C/D "side-by-side" tab */}
        {inReview && selectedTab === "sidebyside" && (
          <DiffViewAndAccept
            oldText={node.review_base_content || ""}
            newText={node.content || ""}
            viewType="split"
            onChange={onContentChange}
            onBaseChange={onReviewBaseContentChange}
            onAllResolved={onAcceptChanges}
          />
        )}

        {/* C/D "per-lines" tab */}
        {inReview && selectedTab === "perlines" && (
          <DiffViewAndAccept
            oldText={node.review_base_content || ""}
            newText={node.content || ""}
            viewType="unified"
            onChange={onContentChange}
            onBaseChange={onReviewBaseContentChange}
            onAllResolved={onAcceptChanges}
          />
        )}
      </div>

      {/* ── [A→B] "IMPROVE WITH AI" BUTTON — mode A with content ──────────────── */}
      <div
        className="overflow-hidden shrink-0 transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: editorMode === "generate" && hasContent && status !== "GENERATING" ? "52px" : "0px" }}
      >
        <div className="flex justify-end px-2 py-1.5">
          <Button onClick={() => onEditorModeChange("improve")}>{tp("improve_with_ai")}</Button>
        </div>
      </div>

      {/* ── [B] IMPROVE FORM — mode B (edit) ─────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col"
        style={{
          maxHeight: editorMode !== "improve" ? "0" : undefined,
          overflow: editorMode !== "improve" ? "hidden" : undefined,
          visibility: editorMode === "improve" ? "visible" : "hidden",
          transition: "max-height 0.3s ease-in-out, visibility 0.3s ease-in-out",
        }}
      >
        <Textarea
          value={node.ai_improve_instruction || ""}
          onChange={onAiImproveInstructionsChange}
          placeholder={tp("improve_placeholder")}
          readOnly={status === "IMPROVING"}
          className="flex-1 basis-auto min-h-[50px] [field-sizing:fixed]! resize-y! overflow-auto"
        />
        <div className="shrink-0 flex items-center justify-between flex-wrap px-2 py-1 border-t border-border">
          <div className="flex items-center gap-2 flex-wrap">
            <AiGenerationSettingsForm value={aiGenerationSettings} onChange={onAiGenerationSettingsChange} />
            {/* {onGenerate.isIdle && adapter.renderEditModeExtras?.(nodeId)} */}
          </div>
          <div className="flex items-center gap-2">
            {status === "SAVED" && (
              <Button
                variant="secondary"
                onClick={() => {
                  onEditorModeChange("generate")
                }}
              >
                {tp("cancel_improve")}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleImprove}
              disabled={status !== "SAVED" || !node.ai_improve_instruction}
            >
              {status === "IMPROVING" ? "Improving…" : tp("improve")}
            </Button>
          </div>
        </div>
      </div>

      {/* ── [D] ACCEPT BAR — mode D (review_unlocked) ────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: inReview ? "1fr" : "0fr",
          transition: "grid-template-rows 300ms ease-in-out",
        }}
        className="shrink-0 border-t border-border"
      >
        <div className="overflow-hidden min-h-0">
          <div className="flex items-center justify-end px-2 py-1.5">
            <Button variant="default" onClick={onAcceptChanges}>
              {tp("accept_changes")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
