import React, { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useTheme } from '../lib/theme/theme-provider'
import { useEditorSettings } from '../lib/editor-settings'
import { useLocale } from '../lib/locale'
import { dispatchLoreNodeSaved } from '../lib/lore-events'
import { BUILTIN_ENGINES } from '../../../shared/ai-engines.js'
import { generateLoreStream } from '../lib/generate-lore-stream'
import LoreDiffView from './LoreDiffView'

interface LoreEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
}

/** 'generate' = mode A; 'edit' = mode B; 'review_locked' = mode C; 'review_unlocked' = mode D */
type EditorMode = 'generate' | 'edit' | 'review_locked' | 'review_unlocked'
type DiffTab = 'new' | 'sidebyside' | 'perlines'

function shortModelName(modelId: string): string {
  return modelId.replace(/^gpt:\/\/[^/]+\//, '')
}

export default function LoreEditor({ nodeId, panelApi }: LoreEditorProps) {
  const { resolvedTheme } = useTheme()
  const { wordWrap } = useEditorSettings()
  const { t } = useLocale()

  // ── Node data ──────────────────────────────────────────────────────────────
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [nameDirty, setNameDirty] = useState(false)
  const [contentDirty, setContentDirty] = useState(false)

  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Editor mode ────────────────────────────────────────────────────────────
  const [editorMode, setEditorMode] = useState<EditorMode>('generate')
  /** Content before the first improvement; used as 'old' side of diffs in modes C/D */
  const [reviewBaseContent, setReviewBaseContent] = useState('')
  const [selectedTab, setSelectedTab] = useState<DiffTab>('new')
  /** Latest content computed from per-lines hunk decisions */
  const [hunkResolvedContent, setHunkResolvedContent] = useState('')

  // ── AI engine config ────────────────────────────────────────────────────────
  const [currentEngine, setCurrentEngine] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [webSearch, setWebSearch] = useState('none')
  const [includeExistingLore, setIncludeExistingLore] = useState(true)

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

  // ── Load node ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    setNameDirty(false)
    setContentDirty(false)
    setGeneratePrompt('')
    setImproveInstruction('')
    setReviewBaseContent('')
    setSelectedTab('new')
    setEditorMode('generate')
    setGenError(null)
    setThinkingStatus(null)
    setThinkingDone(false)

    Promise.all([
      fetch(`/api/lore/${nodeId}`).then(r => r.json() as Promise<{
        name: string
        content: string | null
        changes_status: string | null
        review_base_content: string | null
      }>),
      fetch(`/api/lore/${nodeId}/latest`)
        .then(r => r.json() as Promise<{ source?: string; prompt?: string | null } | null>)
        .catch(() => null),
    ]).then(([node, latestVersion]) => {
      setName(node.name)
      setContent(node.content ?? '')
      if (node.changes_status === 'review') {
        setReviewBaseContent(node.review_base_content ?? '')
        setImproveInstruction(latestVersion?.prompt ?? '')
        setEditorMode('review_unlocked')
      } else if (node.content && node.content.trim().length > 0) {
        setEditorMode('edit')
      } else {
        setEditorMode('generate')
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [nodeId])

  // ── Load AI config ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/ai/config')
      .then(r => r.json())
      .then((data: { current_engine?: string | null; [key: string]: unknown }) => {
        const engine = data.current_engine ?? null
        setCurrentEngine(engine)
        if (!engine) return
        const engineData = data[engine] as { available_models?: string[]; last_model?: string | null } | undefined
        const models = engineData?.available_models ?? []
        setAvailableModels(models)
        const last = engineData?.last_model
        setSelectedModel(last && models.includes(last) ? last : (models[0] ?? ''))
      })
      .catch(() => {})
  }, [])

  // ── Clear timers on unmount ────────────────────────────────────────────────
  useEffect(() => () => {
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
  }, [])

  // ── Name autosave ──────────────────────────────────────────────────────────
  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setName(value)
    setNameDirty(true)
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    nameTimerRef.current = setTimeout(() => {
      if (!value.trim()) { setNameDirty(false); return }
      const trimmed = value.trim()
      fetch(`/api/lore/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      }).then(() => {
        panelApi?.setTitle(trimmed)
        setNameDirty(false)
        dispatchLoreNodeSaved({ id: nodeId, name: trimmed })
      }).catch(() => setNameDirty(false))
    }, 1000)
  }

  // ── Content autosave ───────────────────────────────────────────────────────
  // In mode D (review_unlocked): skip_version so history stays clean during review
  function handleContentChange(value: string) {
    setContent(value)
    setContentDirty(true)
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
    contentTimerRef.current = setTimeout(() => {
      const body: Record<string, unknown> = { content: value, source: 'manual' }
      if (editorMode === 'review_unlocked') body['skip_version'] = true
      fetch(`/api/lore/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json())
        .then((data: { ok: boolean; word_count: number; char_count: number; byte_count: number; ai_sync_info?: Record<string, unknown> | null }) => {
          setContentDirty(false)
          dispatchLoreNodeSaved({
            id: nodeId,
            wordCount: data.word_count,
            charCount: data.char_count,
            byteCount: data.byte_count,
            aiSyncInfo: data.ai_sync_info as Record<string, { last_synced_at: string; file_id?: string; content_updated_at?: string }> | null ?? null,
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
    await fetch(`/api/lore/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: currentContent, source: 'manual' }),
    })
  }

  // ── Save last-used model ───────────────────────────────────────────────────
  function saveLastModel() {
    if (selectedModel && currentEngine) {
      void fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: currentEngine, fields: { last_model: selectedModel } }),
      })
    }
  }

  // ── Mode A: Generate from scratch ─────────────────────────────────────────
  function handleGenerate() {
    if (!generatePrompt.trim()) return
    setContent('')
    setName('')
    setThinkingStatus(null)
    setThinkingDetail(null)
    setThinkingDone(false)
    setGenerating(true)
    setGenError(null)

    let finalName = '', finalContent = '', responseId: string | undefined

    generateLoreStream({
      prompt: generatePrompt,
      includeExistingLore,
      model: selectedModel || undefined,
      webSearch,
      mode: 'generate',
      onThinking: (status, detail) => {
        if (status === 'done') setThinkingDone(true)
        else { setThinkingStatus(status); setThinkingDone(false) }
        setThinkingDetail(detail ?? null)
      },
      onPartialJson: (partial) => {
        if (typeof partial.name === 'string') { setName(partial.name); finalName = partial.name }
        if (typeof partial.content === 'string') { setContent(partial.content); finalContent = partial.content }
      },
      onDone: (data) => { responseId = data.response_id },
    }).then(async () => {
      if (finalName.trim() || finalContent) {
        const patchBody: Record<string, unknown> = { content: finalContent, source: 'ai', prompt: generatePrompt }
        if (responseId) patchBody['response_id'] = responseId
        if (finalName.trim()) patchBody['name'] = finalName.trim()
        const r = await fetch(`/api/lore/${nodeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        })
        const data = await r.json() as { ok: boolean; word_count?: number; char_count?: number; byte_count?: number; ai_sync_info?: Record<string, unknown> | null }
        if (data.ok) {
          if (finalName.trim()) panelApi?.setTitle(finalName.trim())
          dispatchLoreNodeSaved({
            id: nodeId,
            name: finalName.trim() || undefined,
            wordCount: data.word_count,
            charCount: data.char_count,
            byteCount: data.byte_count,
            aiSyncInfo: data.ai_sync_info as Record<string, { last_synced_at: string }> | null ?? null,
          })
          setEditorMode('edit')
        }
      }
      saveLastModel()
    }).catch(e => setGenError(String(e)))
      .finally(() => setGenerating(false))
  }

  // ── Mode B→C or D→C: Improve with AI ──────────────────────────────────────
  async function handleImprove() {
    if (!improveInstruction.trim()) return

    // Capture mode before any state changes (closure preserves this)
    const fromReview = editorMode === 'review_unlocked'
    const baseForStream = fromReview ? reviewBaseContent : content

    if (!fromReview) {
      // First improvement: save current content as baseline
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

    let finalName = '', finalContent = '', responseId: string | undefined

    try {
      await generateLoreStream({
        prompt: improveInstruction,
        includeExistingLore,
        model: selectedModel || undefined,
        webSearch,
        mode: 'improve',
        baseContent: baseForStream,
        onThinking: (status, detail) => {
          if (status === 'done') setThinkingDone(true)
          else { setThinkingStatus(status); setThinkingDone(false) }
          setThinkingDetail(detail ?? null)
        },
        onPartialJson: (partial) => {
          if (typeof partial.name === 'string') { setName(partial.name); finalName = partial.name }
          if (typeof partial.content === 'string') { setContent(partial.content); finalContent = partial.content }
        },
        onDone: (data) => { responseId = data.response_id },
      })

      const patchBody: Record<string, unknown> = {
        content: finalContent,
        source: 'ai',
        prompt: improveInstruction,
      }
      if (responseId) patchBody['response_id'] = responseId
      if (finalName.trim()) patchBody['name'] = finalName.trim()
      if (!fromReview) patchBody['start_review'] = true  // First improvement: capture baseline in DB

      const r = await fetch(`/api/lore/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })
      const data = await r.json() as { ok: boolean; word_count?: number; char_count?: number; byte_count?: number; ai_sync_info?: Record<string, unknown> | null }
      if (data.ok) {
        if (finalName.trim()) panelApi?.setTitle(finalName.trim())
        dispatchLoreNodeSaved({
          id: nodeId,
          name: finalName.trim() || undefined,
          wordCount: data.word_count,
          charCount: data.char_count,
          byteCount: data.byte_count,
          aiSyncInfo: data.ai_sync_info as Record<string, { last_synced_at: string }> | null ?? null,
        })
      }

      saveLastModel()
      setEditorMode('review_unlocked')
      setHunkResolvedContent(finalContent)
    } catch (e) {
      setGenError(String(e))
      // Revert to edit mode so user can retry
      setEditorMode(fromReview ? 'review_unlocked' : 'edit')
    } finally {
      setGenerating(false)
    }
  }

  // ── Mode D→B: Accept changes ───────────────────────────────────────────────
  async function acceptChanges(contentToAccept: string) {
    const r = await fetch(`/api/lore/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept_review: true, content: contentToAccept }),
    })
    const data = await r.json() as { ok: boolean; word_count?: number; char_count?: number; byte_count?: number; ai_sync_info?: Record<string, unknown> | null }
    if (data.ok) {
      dispatchLoreNodeSaved({
        id: nodeId,
        wordCount: data.word_count,
        charCount: data.char_count,
        byteCount: data.byte_count,
        aiSyncInfo: data.ai_sync_info as Record<string, { last_synced_at: string }> | null ?? null,
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

  // Called by LoreDiffView (unified) when all hunks resolved
  async function handleAllHunksResolved() {
    const resolved = hunkResolvedContent || content
    await acceptChanges(resolved)
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === currentEngine)
  const hasContent = content.trim().length > 0
  const isReview = editorMode === 'review_locked' || editorMode === 'review_unlocked'
  const isLocked = editorMode === 'review_locked'

  // ── Shared AI controls row ─────────────────────────────────────────────────
  const aiControls = (
    <div className="flex items-center gap-3 px-2 py-1.5 border-b border-border shrink-0 flex-wrap">
      <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer shrink-0">
        <input
          type="checkbox"
          checked={includeExistingLore}
          onChange={e => setIncludeExistingLore(e.target.checked)}
          className="accent-primary"
          disabled={generating}
        />
        Include existing lore
      </label>

      {engineDef?.webSearch === 'contextSize' && (
        <select
          value={webSearch}
          onChange={e => setWebSearch(e.target.value)}
          disabled={generating}
          className="text-sm border border-border rounded px-2 py-0.5 bg-background disabled:opacity-50"
          title="Web search"
        >
          <option value="none">No web search</option>
          <option value="low">Web: low</option>
          <option value="medium">Web: medium</option>
          <option value="high">Web: high</option>
        </select>
      )}
      {engineDef?.webSearch === 'boolean' && (
        <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={webSearch !== 'none'}
            onChange={e => setWebSearch(e.target.checked ? 'on' : 'none')}
            className="accent-primary"
            disabled={generating}
          />
          Web search
        </label>
      )}

      {availableModels.length > 0 && (
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          disabled={generating}
          className="text-sm border border-border rounded px-2 py-0.5 bg-background max-w-[200px] disabled:opacity-50"
          title="Model"
        >
          {availableModels.map(m => (
            <option key={m} value={m}>{shortModelName(m)}</option>
          ))}
        </select>
      )}
    </div>
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
          <textarea
            value={generatePrompt}
            onChange={e => setGeneratePrompt(e.target.value)}
            placeholder={t('lore.generate_placeholder')}
            disabled={generating}
            className="h-[20vh] min-h-[80px] w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          {aiControls}
          <div className="flex items-center justify-end px-2 py-1 border-b border-border">
            <button
              onClick={handleGenerate}
              disabled={generating || !generatePrompt.trim()}
              className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Generating…' : (hasContent ? t('lore.regenerate') : t('lore.generate'))}
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
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border">
            <input
              type="text"
              value={improveInstruction}
              onChange={e => setImproveInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !isLocked) void handleImprove() }}
              placeholder={t('lore.improve_placeholder')}
              disabled={isLocked}
              className="flex-1 text-sm bg-transparent border-b border-transparent focus:border-primary focus:outline-none px-0.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-w-0"
            />
            <button
              onClick={handleImprove}
              disabled={isLocked || !improveInstruction.trim()}
              className="shrink-0 px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLocked ? 'Generating…' : t('lore.repeat_improve')}
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

      {/* ── NAME FIELD — always visible ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border shrink-0">
        <input
          className="flex-1 text-sm font-semibold bg-transparent border-b border-transparent focus:border-primary focus:outline-none px-0.5 transition-colors"
          value={name}
          onChange={handleNameChange}
          placeholder="Node name"
          aria-label="Node name"
        />
        <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
          {(nameDirty || contentDirty) ? 'Saving…' : 'Saved'}
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
                {tab === 'new' ? t('lore.tab_new')
                  : tab === 'sidebyside' ? t('lore.tab_sidebyside')
                  : t('lore.tab_perlines')}
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
            extensions={[markdown(), ...(wordWrap ? [EditorView.lineWrapping] : [])]}
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
            extensions={[markdown(), ...(wordWrap ? [EditorView.lineWrapping] : [])]}
            theme={resolvedTheme === 'obsidian' ? 'dark' : 'light'}
            onChange={isLocked ? undefined : handleContentChange}
            readOnly={isLocked}
            className="h-full text-sm"
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: true }}
          />
        )}

        {/* C/D "side-by-side" tab */}
        {isReview && selectedTab === 'sidebyside' && (
          <LoreDiffView
            oldText={reviewBaseContent}
            newText={content}
            viewType="split"
          />
        )}

        {/* C/D "per-lines" tab */}
        {isReview && selectedTab === 'perlines' && (
          <LoreDiffView
            key={`${reviewBaseContent.length}-${content.length}`}
            oldText={reviewBaseContent}
            newText={content}
            viewType="unified"
            onChange={v => setHunkResolvedContent(v)}
            onAllResolved={handleAllHunksResolved}
          />
        )}
      </div>

      {/* ── [A→B] "УЛУЧШИТЬ" BUTTON — mode A with content ────────────────────── */}
      <div
        className="overflow-hidden shrink-0 border-t border-border transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: editorMode === 'generate' && hasContent && !generating ? '52px' : '0px' }}
      >
        <div className="flex justify-end px-2 py-1.5">
          <button
            onClick={() => setEditorMode('edit')}
            className="px-3 py-1 text-sm rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('lore.improve_with_ai')}
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
            placeholder={t('lore.improve_placeholder')}
            className="h-[15vh] min-h-[80px] w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}
        {aiControls}
        <div className="flex items-center justify-end gap-2 px-2 py-1">
          {!generating && (
            <button
              onClick={() => { setEditorMode('generate'); setImproveInstruction('') }}
              className="px-3 py-1 text-sm rounded border border-border hover:bg-muted text-muted-foreground"
            >
              {t('lore.cancel_improve')}
            </button>
          )}
          <button
            onClick={handleImprove}
            disabled={generating || !improveInstruction.trim()}
            className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? 'Generating…' : t('lore.improve')}
          </button>
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
              {t('lore.accept_changes')}
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
