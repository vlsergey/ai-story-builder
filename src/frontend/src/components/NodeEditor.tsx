import React, { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useTheme } from '../lib/theme/theme-provider'
import { useEditorSettings } from '../lib/editor-settings'
import { useLocale } from '../lib/locale'
import { generateNodeStream } from '../lib/generate-node-stream'
import { dispatchAiCallCompleted } from '../lib/billing-events'
import { preserveScrollOnExternalUpdate } from '../lib/codemirror-preserve-scroll'
import AiGenerationSettings from './AiGenerationSettings'
import DiffViewAndAccept from './DiffViewAndAccept'
import type { AiSettings } from '../../../shared/ai-settings.js'
import type { AiEngineSyncRecord } from '../types/models'

export interface NodeSavedPayload {
  nodeId: number
  primaryValue?: string
  wordCount?: number
  charCount?: number
  byteCount?: number
  aiSyncInfo?: Record<string, AiEngineSyncRecord> | null
}

export interface NodeEditorAdapter {
  /** API base, e.g. '/api/lore' or '/api/plan/nodes'. Node ID is appended. */
  apiBase: string
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
  /** Show "min words" option in AI settings (plan only) */
  showMinWords?: boolean
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
  const tp = (s: string) => t(`${adapter.i18nPrefix}.${s}` as Parameters<typeof t>[0])

  // ── Node data ──────────────────────────────────────────────────────────────
  const [primaryValue, setPrimaryValue] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [primaryDirty, setPrimaryDirty] = useState(false)
  const [contentDirty, setContentDirty] = useState(false)

  // Plan-only extra fields
  const [userPrompt, setUserPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false)
  const userPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const systemPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const primaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Editor mode ────────────────────────────────────────────────────────────
  const [editorMode, setEditorMode] = useState<EditorMode>('generate')
  const [reviewBaseContent, setReviewBaseContent] = useState('')
  const [selectedTab, setSelectedTab] = useState<DiffTab>('new')

  // ── AI engine config ────────────────────────────────────────────────────────
  const [currentEngine, setCurrentEngine] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [aiSettings, setAiSettings] = useState<AiSettings>({ webSearch: 'none', includeExistingLore: true, maxTokens: 2048 })

  // ── Generate mode (A) ──────────────────────────────────────────────────────
  const [generatePrompt, setGeneratePrompt] = useState('')

  // ── Improve instruction (modes B, C, D) ────────────────────────────────────
  const [improveInstruction, setImproveInstruction] = useState('')

  // ── Generation state ───────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const [thinkingDone, setThinkingDone] = useState(false)

  const apiUrl = `${adapter.apiBase}/${nodeId}`

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

    fetch(apiUrl).then(r => r.json() as Promise<Record<string, unknown>>).then(node => {
      setPrimaryValue(node[adapter.primaryField] as string ?? '')
      setContent(node.content as string ?? '')
      const userPrompt = node.user_prompt as string ?? ''
      const systemPrompt = node.system_prompt as string ?? ''
      if (adapter.i18nPrefix === 'plan') {
        setUserPrompt(userPrompt)
        setSystemPrompt(systemPrompt)
        setGeneratePrompt(userPrompt) // not used for plan, but keep for consistency
      } else {
        // lore nodes
        setGeneratePrompt(userPrompt)
        // keep userPrompt and systemPrompt state for consistency (not used in UI)
        setUserPrompt(userPrompt)
        setSystemPrompt(systemPrompt)
      }
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

  // ── Load AI config ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/ai/config')
      .then(r => r.json())
      .then((data: { current_engine?: string | null; [key: string]: unknown }) => {
        const engine = data.current_engine ?? null
        setCurrentEngine(engine)
        if (!engine) return
        const engineData = data[engine] as {
          available_models?: string[]; last_model?: string | null
          settings?: AiSettings
        } | undefined
        const models = engineData?.available_models ?? []
        setAvailableModels(models)
        const saved = engineData?.settings
        const savedModel = saved?.model ?? engineData?.last_model
        const validModel = savedModel && models.includes(savedModel) ? savedModel : (models[0] ?? '')
        setAiSettings(prev => ({ ...prev, ...(saved ?? {}), model: validModel }))
      })
      .catch(() => {})
  }, [])

  // ── Clear timers on unmount ────────────────────────────────────────────────
  useEffect(() => () => {
    if (primaryTimerRef.current) clearTimeout(primaryTimerRef.current)
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
    if (userPromptTimerRef.current) clearTimeout(userPromptTimerRef.current)
    if (systemPromptTimerRef.current) clearTimeout(systemPromptTimerRef.current)
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
      fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [adapter.primaryField]: trimmed }),
      }).then(() => {
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
      fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
      }).then(r => r.json())
        .then((data: { ok: boolean; word_count: number; char_count: number; byte_count: number; ai_sync_info?: Record<string, unknown> | null }) => {
          setContentDirty(false)
          adapter.onSaved({
            nodeId,
            wordCount: data.word_count,
            charCount: data.char_count,
            byteCount: data.byte_count,
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
    await fetch(apiUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: currentContent }),
    })
  }

  // ── Save last-used model and settings ─────────────────────────────────────
  function saveAiSettings() {
    if (currentEngine) {
      void fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: currentEngine, fields: { settings: aiSettings } }),
      })
    }
  }

  // ── Mode A: Generate from scratch ─────────────────────────────────────────
  function handleGenerate() {
    if (!effectivePrompt.trim()) return
    if (hasContent && !window.confirm(tp('overwrite_warning'))) return
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
      prompt: effectivePrompt,
      settings: aiSettings,
      mode: 'generate',
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
          user_prompt: effectivePrompt.trim(),
        }
        if (adapter.i18nPrefix === 'plan') {
          // plan nodes also have system_prompt, but we don't need to update it here
          // optionally we could include system_prompt: systemPrompt
        }
        if (finalPrimary.trim()) patchBody[adapter.primaryField] = finalPrimary.trim()
        const r = await fetch(apiUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        })
        const data = await r.json() as { ok: boolean; word_count?: number; char_count?: number; byte_count?: number; ai_sync_info?: Record<string, unknown> | null }
        if (data.ok) {
          if (finalPrimary.trim()) panelApi?.setTitle(finalPrimary.trim())
          adapter.onSaved({
            nodeId,
            primaryValue: finalPrimary.trim() || undefined,
            wordCount: data.word_count,
            charCount: data.char_count,
            byteCount: data.byte_count,
            aiSyncInfo: data.ai_sync_info as Record<string, AiEngineSyncRecord> | null ?? null,
          })
          adapter.onAfterGenerate?.()
        }
      }
      saveAiSettings()
      dispatchAiCallCompleted({ costUsdTicks: lastCallData.cost_usd_ticks, tokensInput: lastCallData.tokens_input, tokensOutput: lastCallData.tokens_output, tokensTotal: lastCallData.tokens_total, cachedTokens: lastCallData.cached_tokens, reasoningTokens: lastCallData.reasoning_tokens })
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
        prompt: improveInstruction,
        settings: aiSettings,
        mode: 'improve',
        baseContent: baseForStream,
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
        prompt: improveInstruction,
      }
      if (finalPrimary.trim()) patchBody[adapter.primaryField] = finalPrimary.trim()
      if (!fromReview) {
        patchBody['start_review'] = true
      }

      const r = await fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })
      const data = await r.json() as { ok: boolean; word_count?: number; char_count?: number; byte_count?: number; ai_sync_info?: Record<string, unknown> | null }
      if (data.ok) {
        if (finalPrimary.trim()) panelApi?.setTitle(finalPrimary.trim())
        adapter.onSaved({
          nodeId,
          primaryValue: finalPrimary.trim() || undefined,
          wordCount: data.word_count,
          charCount: data.char_count,
          byteCount: data.byte_count,
          aiSyncInfo: data.ai_sync_info as Record<string, AiEngineSyncRecord> | null ?? null,
        })
      }

      saveAiSettings()
      dispatchAiCallCompleted({ costUsdTicks: improveCallData.cost_usd_ticks, tokensInput: improveCallData.tokens_input, tokensOutput: improveCallData.tokens_output, tokensTotal: improveCallData.tokens_total, cachedTokens: improveCallData.cached_tokens, reasoningTokens: improveCallData.reasoning_tokens })
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
    const r = await fetch(apiUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept_review: true, content: contentToAccept }),
    })
    const data = await r.json() as { ok: boolean; word_count?: number; char_count?: number; byte_count?: number; ai_sync_info?: Record<string, unknown> | null }
    if (data.ok) {
      adapter.onSaved({
        nodeId,
        wordCount: data.word_count,
        charCount: data.char_count,
        byteCount: data.byte_count,
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
  const effectivePrompt = adapter.i18nPrefix === 'plan' ? userPrompt : generatePrompt

  // ── Plan-only: user_prompt autosave ────────────────────────────────────────
  function handleUserPromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setUserPrompt(value)
    if (userPromptTimerRef.current) clearTimeout(userPromptTimerRef.current)
    userPromptTimerRef.current = setTimeout(() => {
      void fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_prompt: value }),
      })
    }, 1000)
  }

  // ── Plan-only: system_prompt autosave ──────────────────────────────────────
  function handleSystemPromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setSystemPrompt(value)
    if (systemPromptTimerRef.current) clearTimeout(systemPromptTimerRef.current)
    systemPromptTimerRef.current = setTimeout(() => {
      void fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: value }),
      })
    }, 1000)
  }

  const aiControls = (
    <AiGenerationSettings
      engineId={currentEngine}
      availableModels={availableModels}
      settings={aiSettings}
      onSettingsChange={setAiSettings}
      showMinWords={adapter.showMinWords}
      disabled={generating}
    />
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

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
          {adapter.i18nPrefix !== 'plan' && (
            <textarea
              value={generatePrompt}
              onChange={e => setGeneratePrompt(e.target.value)}
              placeholder={tp('generate_placeholder')}
              disabled={generating}
              className="h-[20vh] min-h-[80px] w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
          )}
          {aiControls}
          <div className="flex items-center justify-end px-2 py-1 border-b border-border">
            <button
              onClick={handleGenerate}
              disabled={generating || !effectivePrompt.trim()}
              className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Generating…' : (hasContent ? tp('regenerate') : tp('generate'))}
            </button>
          </div>
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
          <div className="flex items-center justify-end px-2 py-1 border-b border-border">
            <button
              onClick={handleImprove}
              disabled={isLocked || !improveInstruction.trim()}
              className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLocked ? 'Generating…' : tp('repeat_improve')}
            </button>
          </div>
          {aiControls}
        </div>
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

      {/* ── PLAN-ONLY: USER PROMPT + SYSTEM PROMPT ────────────────────────────── */}
      {adapter.i18nPrefix === 'plan' && (
        <div className="border-b border-border shrink-0">
          <textarea
            value={userPrompt}
            onChange={handleUserPromptChange}
            placeholder={tp('userPrompt')}
            rows={2}
            className="w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div
            className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-muted/50 text-xs text-muted-foreground select-none"
            onClick={() => setSystemPromptExpanded(prev => !prev)}
          >
            <span>{systemPromptExpanded ? '▾' : '▸'}</span>
            <span>{tp('systemPrompt')}</span>
          </div>
          {systemPromptExpanded && (
            <textarea
              value={systemPrompt}
              onChange={handleSystemPromptChange}
              placeholder={tp('systemPrompt')}
              rows={3}
              className="w-full resize-none border-t border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
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
        {aiControls}
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <div className="flex items-center gap-2">
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
