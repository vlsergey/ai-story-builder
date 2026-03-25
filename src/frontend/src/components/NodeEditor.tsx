import React, { useCallback, useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useTheme } from '../lib/theme/theme-provider'
import { useEditorSettings } from '../lib/editor-settings'
import { useLocale } from '../lib/locale'
import { generateNodeStream } from '../lib/generate-node-stream'
import { dispatchAiCallCompleted } from '../lib/billing-events'
import { dispatchPlanGraphRefresh } from '../lib/plan-graph-events'
import { preserveScrollOnExternalUpdate } from '../lib/codemirror-preserve-scroll'
import DiffViewAndAccept from './DiffViewAndAccept'
import type { AiGenerationSettings } from '../../../shared/ai-generation-settings'
import type { AiEngineSyncRecord } from '../types/models'
import { ipcClient, trpc } from '../ipcClient'
import { Button } from './ui/button'
import AiGenerationSettingsForm from './AiGenerationSettingsForm'

import { Textarea } from './ui/textarea'
import { Field, FieldContent, FieldLabel } from './ui/field'

export interface NodeSavedPayload {
  nodeId: number
  primaryValue?: string
  wordCount?: number
  charCount?: number
  byteCount?: number
  aiSyncInfo?: Record<string, AiEngineSyncRecord> | null
}

export interface NodeEditorAdapter {
  /** Fetch a single node by id. */
  getNode: (id: number) => Promise<Record<string, unknown>>
  /** Patch a node and return updated stats. */
  patchNode: (id: number, data: Record<string, unknown>) => Promise<{ ok: boolean; word_count?: number | null; char_count?: number | null; byte_count?: number | null; ai_sync_info?: Record<string, unknown> | null }>
  /** Primary text field name in the API and partial-JSON stream */
  primaryField: 'name' | 'title'
  /** i18n key prefix: 'lore' or 'plan' */
  i18nPrefix: string
  /** Backend SSE endpoint for AI generation */
  generateEndpoint: string
  /** Called after any successful node PATCH (content or primary field saved) */
  onSaved: (payload: NodeSavedPayload) => void
  /** Called after generate completes (e.g. dispatchPlanTreeRefresh) */
  onAfterGenerate?: () => void
  /** Extra buttons rendered in the edit-mode footer (e.g. "split into children") */
  renderEditModeExtras?: (nodeId: number) => React.ReactNode
  /** Whether this adapter supports auto‑generation of summary on editor close */
  supportsAutoSummary?: boolean
}

interface NodeEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
  adapter: NodeEditorAdapter
}

/** 'generate' = mode A; 'edit' = mode B; 'review_locked' = mode C; 'review_unlocked' = mode D */
type EditorMode = 'generate' | 'edit' | 'review_locked' | 'review_unlocked'
type DiffTab = 'new' | 'sidebyside' | 'perlines'

export default function NodeEditor({ nodeId, panelApi, adapter }: NodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const { wordWrap } = useEditorSettings()
  const { t } = useLocale()
  const tp = (s: string) => t(`${adapter.i18nPrefix}.${s}`)

  // ── Node data ──────────────────────────────────────────────────────────────
  const [primaryValue, setPrimaryValue] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [primaryDirty, setPrimaryDirty] = useState(false)
  const [contentDirty, setContentDirty] = useState(false)
  const [initialContent, setInitialContent] = useState('')
  const [initialPrimary, setInitialPrimary] = useState('')

  const autoGenerateSummary = trpc.settings.autoGenerateSummary.get.useQuery().data || false

  // AI instructions (single field)
  const [aiInstructions, setAiInstructions] = useState('')
  const aiInstructionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const primaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const summaryTriggeredRef = useRef(false)

  // Refs for summary generation (to avoid stale closures)
  const contentRef = useRef('')
  const dirtyRef = useRef(false)
  const autoGenerateSummaryRef = useRef(false)
  const adapterRef = useRef(adapter)

  // ── Editor mode ────────────────────────────────────────────────────────────
  const [editorMode, setEditorMode] = useState<EditorMode>('generate')
  const [reviewBaseContent, setReviewBaseContent] = useState('')
  const [selectedTab, setSelectedTab] = useState<DiffTab>('new')

  // ── AI engine config ────────────────────────────────────────────────────────
  const currentAiEngine = trpc.settings.allAiEnginesConfig.currentEngine.get.useQuery().data || null
  const [nodeAiGenerationSettings, setNodeAiGenerationSettings] = useState<Record<string, AiGenerationSettings>>({})

  // ── Generate mode (A) ──────────────────────────────────────────────────────
  // generatePrompt removed, using aiInstructions instead

  // ── Improve instruction (modes B, C, D) ────────────────────────────────────
  const [improveInstruction, setImproveInstruction] = useState('')

  // ── Generation state ───────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const [thinkingDone, setThinkingDone] = useState(false)

  // Keep refs up to date with current state (for summary generation)
  contentRef.current = content
  autoGenerateSummaryRef.current = autoGenerateSummary
  adapterRef.current = adapter
  dirtyRef.current = content !== initialContent || primaryValue !== initialPrimary

  // ── Load node ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    setPrimaryDirty(false)
    setContentDirty(false)
    setImproveInstruction('')
    setReviewBaseContent('')
    setSelectedTab('new')
    setEditorMode('generate')
    setGenError(null)
    setThinkingStatus(null)
    setThinkingDone(false)

    adapter.getNode(nodeId).then(node => {
      setPrimaryValue(node[adapter.primaryField] as string ?? '')
      setContent(node.content as string ?? '')
      setInitialPrimary(node[adapter.primaryField] as string ?? '')
      setInitialContent(node.content as string ?? '')
      summaryTriggeredRef.current = false
      const aiInstructions = node.ai_instructions as string ?? ''
      setAiInstructions(aiInstructions)
      // parse ai_settings
      const aiSettingsRaw = node.ai_settings as string | undefined
      let parsed: Record<string, AiGenerationSettings> | null = null
      if (aiSettingsRaw && aiSettingsRaw.trim() !== '') {
        try {
          parsed = JSON.parse(aiSettingsRaw)
        } catch {
          // ignore
        }
      }
      setNodeAiGenerationSettings(parsed || {})
      // generatePrompt removed
      if (node.changes_status === 'review') {
        setReviewBaseContent(node.review_base_content as string ?? '')
        setImproveInstruction(node.last_improve_instruction as string ?? '')
        setEditorMode('review_unlocked')
      } else if (node.content && (node.content as string).trim().length > 0 && node.last_improve_instruction) {
        setImproveInstruction(node.last_improve_instruction as string)
        setEditorMode('edit')
      } else {
        setEditorMode('generate')
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [nodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update panel title when primary value changes ─────────────────────────
  useEffect(() => {
    if (primaryValue && panelApi) {
      panelApi.setTitle(primaryValue)
    }
  }, [primaryValue, panelApi])

  // ── Trigger summary generation on editor close ─────────────────────────────
  useEffect(() => {
    return () => {
      // Only for adapters that support auto‑summary, when setting enabled, content changed, and not already triggered
      if (
        adapterRef.current.supportsAutoSummary &&
        autoGenerateSummaryRef.current &&
        !summaryTriggeredRef.current &&
        dirtyRef.current
      ) {
        summaryTriggeredRef.current = true
        // Fire and forget, but dispatch a graph refresh after a short delay
        ipcClient.ai.generateSummary.mutate({ node_id: nodeId, content: contentRef.current || undefined })
          .then(() => {
            // Give the backend a moment to update the node, then refresh the graph
            setTimeout(() => dispatchPlanGraphRefresh(), 2000)
          })
          .catch(() => {})
      }
    }
  }, [nodeId])

  // ── Clear timers on unmount ────────────────────────────────────────────────
  useEffect(() => () => {
    if (primaryTimerRef.current) clearTimeout(primaryTimerRef.current)
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
    if (aiInstructionsTimerRef.current) clearTimeout(aiInstructionsTimerRef.current)
  }, [])

  // ── Primary field autosave ─────────────────────────────────────────────────
  function handlePrimaryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setPrimaryValue(value)
    setPrimaryDirty(true)
    if (primaryTimerRef.current) clearTimeout(primaryTimerRef.current)
    primaryTimerRef.current = setTimeout(() => {
      if (!value.trim()) { setPrimaryDirty(false); return }
      const trimmed = value.trim()
      adapter.patchNode(nodeId, { [adapter.primaryField]: trimmed }).then(() => {
        panelApi?.setTitle(trimmed)
        setPrimaryDirty(false)
        adapter.onSaved({ nodeId, primaryValue: trimmed })
      }).catch(() => setPrimaryDirty(false))
    }, 1000)
  }

  // ── Content autosave ───────────────────────────────────────────────────────
  function handleContentChange(value: string) {
    setContent(value)
    setContentDirty(true)
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
    contentTimerRef.current = setTimeout(() => {
      adapter.patchNode(nodeId, { content: value })
        .then((data) => {
          setContentDirty(false)
          adapter.onSaved({
            nodeId,
            wordCount: data.word_count ?? undefined,
            charCount: data.char_count ?? undefined,
            byteCount: data.byte_count ?? undefined,
            aiSyncInfo: data.ai_sync_info as Record<string, AiEngineSyncRecord> | null ?? null,
          })
        }).catch(() => setContentDirty(false))
    }, 1000)
  }

  // ── Force-flush pending content save before AI calls ─────────────────────
  async function flushContentSave(currentContent: string): Promise<void> {
    if (contentTimerRef.current) {
      clearTimeout(contentTimerRef.current)
      contentTimerRef.current = null
    }
    setContentDirty(false)
    await adapter.patchNode(nodeId, { content: currentContent })
  }

  const updateNodeAiGenerationSettings = useCallback(async (newSettings: Record<string, AiGenerationSettings>) => {
    const toStore = newSettings || {};
    await adapter.patchNode(nodeId, { ai_settings: JSON.stringify(toStore) });
  }, [adapter, nodeId])

  const aiGenerationSettings : (AiGenerationSettings | null) = currentAiEngine ? nodeAiGenerationSettings[currentAiEngine] ?? null : null
  const onAiGenerationSettingsChange = useCallback(async (value: AiGenerationSettings | null) => {
    if (!currentAiEngine) return;
    const newNodeAiGenerationSettings = { ...nodeAiGenerationSettings }
    if ( value == null ) {
      delete newNodeAiGenerationSettings[currentAiEngine]
    } else {
      newNodeAiGenerationSettings[currentAiEngine] = value
    }
    setNodeAiGenerationSettings(newNodeAiGenerationSettings);
    await updateNodeAiGenerationSettings(newNodeAiGenerationSettings);
  }, [currentAiEngine, nodeAiGenerationSettings, setNodeAiGenerationSettings, updateNodeAiGenerationSettings])

  function computeTextMetrics(text: string): { bytes: number; chars: number; words: number } {
    const bytes = new TextEncoder().encode(text).length;
    const chars = text.length;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    return { bytes, chars, words };
  }

  // ── Mode A: Generate from scratch ─────────────────────────────────────────
  function handleGenerate() {
    if (!effectivePrompt.trim()) return
    if (hasContent) {
      const message = tp('overwrite_warning')
      const confirmed = window.electronAPI.confirm(message)
      if (!confirmed) return
    }
    setThinkingStatus(null)
    setThinkingDetail(null)
    setThinkingDone(false)
    setGenerating(true)
    setGenError(null)

    let finalPrimary = '', finalContent = ''
    // Content and primary field are cleared on the first streaming token so that
    // existing content is preserved if generation fails before producing anything.
    let firstTokenCleared = false
    let lastCallData: { cost_usd_ticks?: number; tokens_input?: number; tokens_output?: number; tokens_total?: number; cached_tokens?: number; reasoning_tokens?: number } = {}

    generateNodeStream(adapter.generateEndpoint, {
      instructions: effectivePrompt,
      aiGenerationSettings,
      mode: 'generate',
      nodeId: nodeId,
      onThinking: (status, detail) => {
        if (status === 'done') setThinkingDone(true)
        else { setThinkingStatus(status); setThinkingDone(false) }
        setThinkingDetail(detail ?? null)
      },
      onPartialJson: (partial) => {
        if (!firstTokenCleared) {
          setContent('')
          setPrimaryValue('')
          firstTokenCleared = true
        }
        if (typeof partial[adapter.primaryField] === 'string') {
          setPrimaryValue(partial[adapter.primaryField] as string)
          finalPrimary = partial[adapter.primaryField] as string
        }
        if (typeof partial.content === 'string') { setContent(partial.content); finalContent = partial.content }
      },
      onDone: (data) => { lastCallData = data },
    }).then(async () => {
    if (finalPrimary.trim() || finalContent) {
      const patchBody: Record<string, unknown> = {
        content: finalContent,
        ai_instructions: effectivePrompt.trim(),
      }
      if (finalPrimary.trim()) patchBody[adapter.primaryField] = finalPrimary.trim()
      const data = await adapter.patchNode(nodeId, patchBody)
        if (data.ok) {
          if (finalPrimary.trim()) panelApi?.setTitle(finalPrimary.trim())
          adapter.onSaved({
            nodeId,
            primaryValue: finalPrimary.trim() || undefined,
            wordCount: data.word_count ?? undefined,
            charCount: data.char_count ?? undefined,
            byteCount: data.byte_count ?? undefined,
            aiSyncInfo: data.ai_sync_info as Record<string, AiEngineSyncRecord> | null ?? null,
          })
          adapter.onAfterGenerate?.()
        }
      }
      const { bytes, chars, words } = computeTextMetrics(finalContent);
      dispatchAiCallCompleted({
        costUsdTicks: lastCallData.cost_usd_ticks,
        tokensInput: lastCallData.tokens_input,
        tokensOutput: lastCallData.tokens_output,
        tokensTotal: lastCallData.tokens_total,
        cachedTokens: lastCallData.cached_tokens,
        reasoningTokens: lastCallData.reasoning_tokens,
        responseBytes: bytes,
        responseChars: chars,
        responseWords: words
      })
    }).catch(e => setGenError(String(e)))
      .finally(() => setGenerating(false))
  }

  // ── Mode B→C or D→C: Improve with AI ──────────────────────────────────────
  async function handleImprove() {
    if (!improveInstruction.trim()) return

    const fromReview = editorMode === 'review_unlocked'
    const baseForStream = fromReview ? reviewBaseContent : content

    if (!fromReview) {
      setReviewBaseContent(content)
      if (contentDirty) await flushContentSave(content)
      // Start review before generation
      await ipcClient.planGraph.startReview.mutate({id: nodeId, options: { prompt: improveInstruction }})
    }

    setContent('')
    setThinkingStatus(null)
    setThinkingDetail(null)
    setThinkingDone(false)
    setGenerating(true)
    setGenError(null)
    setEditorMode('review_locked')
    setSelectedTab('new')

    let finalPrimary = '', finalContent = ''
    let improveCallData: { cost_usd_ticks?: number; tokens_input?: number; tokens_output?: number; tokens_total?: number; cached_tokens?: number; reasoning_tokens?: number } = {}

    try {
      await generateNodeStream(adapter.generateEndpoint, {
        instructions: improveInstruction,
        aiGenerationSettings: aiGenerationSettings,
        mode: 'improve',
        baseContent: baseForStream,
        nodeId: nodeId,
        onThinking: (status, detail) => {
          if (status === 'done') setThinkingDone(true)
          else { setThinkingStatus(status); setThinkingDone(false) }
          setThinkingDetail(detail ?? null)
        },
        onPartialJson: (partial) => {
          if (typeof partial[adapter.primaryField] === 'string') {
            setPrimaryValue(partial[adapter.primaryField] as string)
            finalPrimary = partial[adapter.primaryField] as string
          }
          if (typeof partial.content === 'string') { setContent(partial.content); finalContent = partial.content }
        },
        onDone: (data) => { improveCallData = data },
      })

      const patchBody: Record<string, unknown> = {
        content: finalContent,
        last_improve_instruction: improveInstruction,
      }
      if (finalPrimary.trim()) patchBody[adapter.primaryField] = finalPrimary.trim()

      const data = await adapter.patchNode(nodeId, patchBody)
      if (data.ok) {
        if (finalPrimary.trim()) panelApi?.setTitle(finalPrimary.trim())
        adapter.onSaved({
          nodeId,
          primaryValue: finalPrimary.trim() || undefined,
          wordCount: data.word_count ?? undefined,
          charCount: data.char_count ?? undefined,
          byteCount: data.byte_count ?? undefined,
          aiSyncInfo: data.ai_sync_info as Record<string, AiEngineSyncRecord> | null ?? null,
        })
      }

      const { bytes, chars, words } = computeTextMetrics(finalContent);
      dispatchAiCallCompleted({
        costUsdTicks: improveCallData.cost_usd_ticks,
        tokensInput: improveCallData.tokens_input,
        tokensOutput: improveCallData.tokens_output,
        tokensTotal: improveCallData.tokens_total,
        cachedTokens: improveCallData.cached_tokens,
        reasoningTokens: improveCallData.reasoning_tokens,
        responseBytes: bytes,
        responseChars: chars,
        responseWords: words
      })
      setEditorMode('review_unlocked')
    } catch (e) {
      setGenError(String(e))
      setEditorMode(fromReview ? 'review_unlocked' : 'edit')
    } finally {
      setGenerating(false)
    }
  }

  // ── Mode D→B: Accept changes ───────────────────────────────────────────────
  async function acceptChanges(contentToAccept: string) {
    // Accept review via IPC (plan nodes only)
    await ipcClient.planGraph.acceptReview.mutate(nodeId)
    // Update content via adapter
    const data = await adapter.patchNode(nodeId, { content: contentToAccept })
    if (data.ok) {
      adapter.onSaved({
        nodeId,
        wordCount: data.word_count ?? undefined,
        charCount: data.char_count ?? undefined,
        byteCount: data.byte_count ?? undefined,
        aiSyncInfo: data.ai_sync_info as Record<string, AiEngineSyncRecord> | null ?? null,
      })
    }
    setContent(contentToAccept)
    setEditorMode('edit')
    setReviewBaseContent('')
    setSelectedTab('new')
  }

  function handleAcceptChanges() {
    void acceptChanges(content)
  }

  async function handleAllHunksResolved() {
    await acceptChanges(content)
  }

  const hasContent = content.trim().length > 0
  const isReview = editorMode === 'review_locked' || editorMode === 'review_unlocked'
  const isLocked = editorMode === 'review_locked'
  const effectivePrompt = aiInstructions

  // ── ai_instructions autosave ──────────────────────────────────────────────
  function handleAiInstructionsChange(value: string) {
    setAiInstructions(value)
    if (aiInstructionsTimerRef.current) clearTimeout(aiInstructionsTimerRef.current)
    aiInstructionsTimerRef.current = setTimeout(() => {
      void adapter.patchNode(nodeId, { ai_instructions: value })
    }, 1000)
  }


  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden p-4">

      {/* ── [A] GENERATE CONTROLS — mode 'generate' only ──────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: editorMode === 'generate' ? '1fr' : '0fr',
          transition: 'grid-template-rows 300ms ease-in-out',
        }}
        className="shrink-0"
      >
        <div className="overflow-hidden min-h-0">
          {/* No separate generate prompt textarea; prompts are shown below for all adapters */}
        </div>
      </div>

      {/* ── [C/D] COMPACT INSTRUCTION BAR — modes C and D ────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: isReview ? '1fr' : '0fr',
          transition: 'grid-template-rows 300ms ease-in-out',
        }}
        className="shrink-0"
      >
        <div className="overflow-hidden min-h-0">
          <textarea
            value={improveInstruction}
            onChange={e => setImproveInstruction(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !isLocked) { e.preventDefault(); void handleImprove() } }}
            placeholder={tp('improve_placeholder')}
            disabled={isLocked}
            rows={2}
            className="w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <div className='flex item-center w-full shrink-0'>
            <AiGenerationSettingsForm
              className="flex-grow"
              value={aiGenerationSettings}
              onChange={onAiGenerationSettingsChange}
            />
            <Button
              className="shrink-0 self-end"
              onClick={handleImprove}
              variant="secondary"
              disabled={isLocked || !improveInstruction.trim()}
            >
              {isLocked ? 'Generating…' : tp('repeat_improve')}
            </Button>
          </div>
        </div>
      </div>

      {/* ── AI INSTRUCTIONS (single field) ────────────────────────────────────── */}
      <Field className="flex-1 w-full flex flex-col">
        <FieldContent className="shrink-0 flex-none">
          <FieldLabel>{tp('aiInstructions')}</FieldLabel>
        </FieldContent>
        <Textarea
          className="flex-1 w-full"
          value={aiInstructions}
          onChange={(e) => handleAiInstructionsChange(e.target.value)}
          placeholder={tp('aiInstructions')}
        />
      </Field>

      {/* ── AI CONTROLS & GENERATE BUTTON — after prompts, mode 'generate' only ───── */}
      {editorMode === 'generate' && (
        <div className='flex item-center w-full'>
          <AiGenerationSettingsForm
            className="flex-grow"
            value={aiGenerationSettings}
            onChange={onAiGenerationSettingsChange}
          />
          <Button
            className="shrink-0 self-end m-4"
            variant="default"
            onClick={handleGenerate}
            disabled={generating || !effectivePrompt.trim()}
          >
            {generating ? 'Generating…' : (hasContent ? tp('regenerate') : tp('generate'))}
          </Button>
        </div>
      )}

      {/* ── PRIMARY FIELD — always visible ───────────────────────────────────── */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border shrink-0">
        <input
          className="flex-1 text-sm font-semibold bg-transparent border-b border-transparent focus:border-primary focus:outline-none px-0.5 transition-colors"
          value={primaryValue}
          onChange={handlePrimaryChange}
          placeholder={`Node ${adapter.primaryField}`}
          aria-label={`Node ${adapter.primaryField}`}
        />
        <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
          {(primaryDirty || contentDirty) ? 'Saving…' : 'Saved'}
        </span>
      </div>

      {/* ── STATUS ROWS — always visible ────────────────────────────────────── */}
      {thinkingStatus !== null && (
        <div className="flex items-start gap-2 px-2 py-1 text-sm text-muted-foreground border-b border-border shrink-0">
          <div className="mt-0.5 shrink-0">
            {thinkingDone
              ? <CheckCircle2 className="h-4 w-4 text-green-500" />
              : <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          <div className="min-w-0">
            <div>{t(`thinking.${thinkingDone ? 'done' : thinkingStatus}`)}</div>
            {thinkingDetail && (
              <div className="text-xs text-muted-foreground/70 truncate" title={thinkingDetail}>
                {thinkingDetail}
              </div>
            )}
          </div>
        </div>
      )}
      {genError && (
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0">
          {genError}
        </div>
      )}

      {/* ── [C/D] TAB BAR — visible in review modes ──────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: isReview ? '1fr' : '0fr',
          transition: 'grid-template-rows 300ms ease-in-out',
        }}
        className="shrink-0"
      >
        <div className="overflow-hidden min-h-0">
          <div className="flex border-b border-border">
            {(['new', 'sidebyside', 'perlines'] as DiffTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => !isLocked && setSelectedTab(tab)}
                disabled={isLocked}
                className={`px-3 py-1.5 text-sm border-r border-border last:border-r-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedTab === tab
                    ? 'bg-background text-foreground font-medium'
                    : 'bg-muted text-muted-foreground hover:bg-background/70'
                }`}
              >
                {tab === 'new' ? tp('tab_new')
                  : tab === 'sidebyside' ? tp('tab_sidebyside')
                  : tp('tab_perlines')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── CONTENT AREA — flex-1 ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {/* Modes A/B: editable CodeMirror */}
        {!isReview && (
          <CodeMirror
            value={content}
            height="100%"
            extensions={[markdown(), preserveScrollOnExternalUpdate, ...(wordWrap ? [EditorView.lineWrapping] : [])]}
            theme={resolvedTheme === 'obsidian' ? 'dark' : 'light'}
            onChange={handleContentChange}
            className="h-full text-sm"
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: true }}
          />
        )}

        {/* Mode C (locked) / D (unlocked) "new" tab: CodeMirror */}
        {isReview && selectedTab === 'new' && (
          <CodeMirror
            value={content}
            height="100%"
            extensions={[markdown(), preserveScrollOnExternalUpdate, ...(wordWrap ? [EditorView.lineWrapping] : [])]}
            theme={resolvedTheme === 'obsidian' ? 'dark' : 'light'}
            onChange={isLocked ? undefined : handleContentChange}
            readOnly={isLocked}
            className="h-full text-sm"
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: true }}
          />
        )}

        {/* C/D "side-by-side" tab */}
        {isReview && selectedTab === 'sidebyside' && (
          <DiffViewAndAccept
            oldText={reviewBaseContent}
            newText={content}
            viewType="split"
            onChange={v => setContent(v)}
            onBaseChange={v => setReviewBaseContent(v)}
            onAllResolved={handleAllHunksResolved}
          />
        )}

        {/* C/D "per-lines" tab */}
        {isReview && selectedTab === 'perlines' && (
          <DiffViewAndAccept
            oldText={reviewBaseContent}
            newText={content}
            viewType="unified"
            onChange={v => setContent(v)}
            onBaseChange={v => setReviewBaseContent(v)}
            onAllResolved={handleAllHunksResolved}
          />
        )}
      </div>

      {/* ── [A→B] "IMPROVE WITH AI" BUTTON — mode A with content ──────────────── */}
      <div
        className="overflow-hidden shrink-0 border-t border-border transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: editorMode === 'generate' && hasContent && !generating ? '52px' : '0px' }}
      >
        <div className="flex justify-end px-2 py-1.5">
          <button
            onClick={() => setEditorMode('edit')}
            className="px-3 py-1 text-sm rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {tp('improve_with_ai')}
          </button>
        </div>
      </div>

      {/* ── [B] IMPROVE FORM — mode B (edit) ─────────────────────────────────── */}
      <div
        className="overflow-hidden shrink-0 transition-[max-height] duration-300 ease-in-out border-t border-border"
        style={{ maxHeight: editorMode === 'edit' ? '50vh' : '0px' }}
      >
        {generating ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground border-b border-border truncate">
            {improveInstruction}
          </div>
        ) : (
          <textarea
            value={improveInstruction}
            onChange={e => setImproveInstruction(e.target.value)}
            placeholder={tp('improve_placeholder')}
            className="h-[15vh] min-h-[80px] w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}
        <div className="flex items-center justify-between flex-wrap px-2 py-1 border-t border-border">
          <div className="flex items-center gap-2 flex-wrap">
            <AiGenerationSettingsForm
              value={aiGenerationSettings}
              onChange={onAiGenerationSettingsChange}
            />
            {!generating && adapter.renderEditModeExtras?.(nodeId)}
          </div>
          <div className="flex items-center gap-2">
            {!generating && (
              <button
                onClick={() => { setEditorMode('generate'); setImproveInstruction('') }}
                className="px-3 py-1 text-sm rounded border border-border hover:bg-muted text-muted-foreground"
              >
                {tp('cancel_improve')}
              </button>
            )}
            <button
              onClick={handleImprove}
              disabled={generating || !improveInstruction.trim()}
              className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Generating…' : tp('improve')}
            </button>
          </div>
        </div>
      </div>

      {/* ── [D] ACCEPT BAR — mode D (review_unlocked) ────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: editorMode === 'review_unlocked' ? '1fr' : '0fr',
          transition: 'grid-template-rows 300ms ease-in-out',
        }}
        className="shrink-0 border-t border-border"
      >
        <div className="overflow-hidden min-h-0">
          <div className="flex items-center justify-end px-2 py-1.5">
            <button
              onClick={handleAcceptChanges}
              className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {tp('accept_changes')}
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}

