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

interface LoreEditorProps {
  nodeId: number
  /** Dockview panel API — used to update the tab title on rename */
  panelApi?: { setTitle: (title: string) => void }
}

/** Strips the `gpt://folder_id/` prefix from Yandex model URIs for display. */
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
  /** Source of the latest saved version ('ai' | 'manual' | null if no versions yet) */
  const [latestVersionSource, setLatestVersionSource] = useState<string | null>(null)

  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── AI engine config ────────────────────────────────────────────────────────
  const [currentEngine, setCurrentEngine] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [webSearch, setWebSearch] = useState('none')
  const [includeExistingLore, setIncludeExistingLore] = useState(true)

  // ── Generate mode state ────────────────────────────────────────────────────
  const [generatePrompt, setGeneratePrompt] = useState('')

  // ── Improve mode state ─────────────────────────────────────────────────────
  /** 'generate' = normal (prompt + generate btn at top) | 'improve' = improvement instruction at top */
  const [mode, setMode] = useState<'generate' | 'improve'>('generate')
  const [improveInstruction, setImproveInstruction] = useState('')

  // ── Shared generation state ────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const [thinkingDone, setThinkingDone] = useState(false)

  // ── Load node data + latest version source ─────────────────────────────────
  useEffect(() => {
    setLoading(true)
    setNameDirty(false)
    setContentDirty(false)
    setMode('generate')
    setGeneratePrompt('')
    setImproveInstruction('')
    Promise.all([
      fetch(`/api/lore/${nodeId}`).then(r => r.json() as Promise<{ name: string; content: string | null }>),
      fetch(`/api/lore/${nodeId}/latest`).then(r => r.json() as Promise<{ source?: string } | null>).catch(() => null),
    ]).then(([node, latestVersion]) => {
      setName(node.name)
      setContent(node.content ?? '')
      setLatestVersionSource(latestVersion?.source ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [nodeId])

  // ── Load AI engine config ──────────────────────────────────────────────────
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

  // ── Manual name change (autosave with debounce) ────────────────────────────
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

  // ── Manual content change (autosave with debounce) ─────────────────────────
  function handleContentChange(value: string) {
    setContent(value)
    setContentDirty(true)
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
    contentTimerRef.current = setTimeout(() => {
      fetch(`/api/lore/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value, source: 'manual' }),
      }).then(r => r.json())
        .then((data: { ok: boolean; word_count: number; char_count: number; byte_count: number; ai_sync_info?: Record<string, { last_synced_at: string; file_id?: string; content_updated_at?: string }> | null }) => {
          setContentDirty(false)
          setLatestVersionSource('manual')
          dispatchLoreNodeSaved({ id: nodeId, wordCount: data.word_count, charCount: data.char_count, byteCount: data.byte_count, aiSyncInfo: data.ai_sync_info ?? null })
        }).catch(() => setContentDirty(false))
    }, 1000)
  }

  // ── Shared generate/improve logic ──────────────────────────────────────────
  async function runGeneration(opts: { mode: 'generate' | 'improve'; prompt: string; baseContent?: string }) {
    // Cancel any pending manual-edit saves
    if (nameTimerRef.current) { clearTimeout(nameTimerRef.current); nameTimerRef.current = null; setNameDirty(false) }
    if (contentTimerRef.current) { clearTimeout(contentTimerRef.current); contentTimerRef.current = null; setContentDirty(false) }
    setContent('')
    setName('')
    setThinkingStatus(null)
    setThinkingDetail(null)
    setThinkingDone(false)
    setGenerating(true)
    setGenError(null)

    let finalName = ''
    let finalContent = ''
    let responseId: string | undefined

    try {
      await generateLoreStream({
        prompt: opts.prompt,
        includeExistingLore,
        model: selectedModel || undefined,
        webSearch,
        mode: opts.mode,
        baseContent: opts.baseContent,
        onThinking: (status, detail) => {
          if (status === 'done') { setThinkingDone(true) }
          else { setThinkingStatus(status); setThinkingDone(false) }
          setThinkingDetail(detail ?? null)
        },
        onPartialJson: (partial) => {
          if (typeof partial.name === 'string') { setName(partial.name); finalName = partial.name }
          if (typeof partial.content === 'string') { setContent(partial.content); finalContent = partial.content }
        },
        onDone: (data) => { responseId = data.response_id },
      })

      // Save the AI-generated content to this node
      if (finalName.trim() || finalContent) {
        const patchBody: Record<string, unknown> = {
          content: finalContent,
          source: 'ai',
          prompt: opts.prompt,
        }
        if (responseId) patchBody['response_id'] = responseId
        if (finalName.trim()) patchBody['name'] = finalName.trim()

        const r = await fetch(`/api/lore/${nodeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        })
        const data = await r.json() as {
          ok: boolean; word_count?: number; char_count?: number; byte_count?: number;
          ai_sync_info?: Record<string, { last_synced_at: string; file_id?: string; content_updated_at?: string }> | null
        }
        if (data.ok) {
          setLatestVersionSource('ai')
          if (finalName.trim()) panelApi?.setTitle(finalName.trim())
          dispatchLoreNodeSaved({
            id: nodeId,
            name: finalName.trim() || undefined,
            wordCount: data.word_count,
            charCount: data.char_count,
            byteCount: data.byte_count,
            aiSyncInfo: data.ai_sync_info ?? null,
          })
        }
      }

      if (selectedModel && currentEngine) {
        void fetch('/api/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine: currentEngine, fields: { last_model: selectedModel } }),
        })
      }
    } catch (e) {
      setGenError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  // ── Handle "Generate / Regenerate" click ───────────────────────────────────
  function handleGenerate() {
    if (!generatePrompt.trim()) return
    // Warn if content was manually edited and is non-empty
    if (latestVersionSource === 'manual' && content.trim()) {
      if (!window.confirm(t('lore.overwrite_warning'))) return
    }
    void runGeneration({ mode: 'generate', prompt: generatePrompt })
  }

  // ── Handle "Улучшить" click ────────────────────────────────────────────────
  function handleImprove() {
    if (!improveInstruction.trim()) return
    void runGeneration({ mode: 'improve', prompt: improveInstruction, baseContent: content })
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === currentEngine)
  const hasContent = content.trim().length > 0

  // ── Shared AI controls row (model, web search, include lore) ───────────────
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

  // ── Thinking / error status rows ────────────────────────────────────────────
  const statusRows = (
    <>
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
    </>
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

      {/* ── Generate mode: prompt area ─────────────────────────────────────── */}
      {mode === 'generate' && (
        <>
          <textarea
            value={generatePrompt}
            onChange={e => setGeneratePrompt(e.target.value)}
            placeholder={t('lore.generate_placeholder')}
            disabled={generating}
            className="h-1/5 w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring shrink-0 disabled:opacity-60"
          />
          {aiControls}
          {/* Generate / Regenerate button row */}
          <div className="flex items-center justify-end px-2 py-1 border-b border-border shrink-0">
            <button
              onClick={handleGenerate}
              disabled={generating || !generatePrompt.trim()}
              className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Generating…' : (hasContent ? t('lore.regenerate') : t('lore.generate'))}
            </button>
          </div>
          {statusRows}
        </>
      )}

      {/* ── Improve mode: instruction area ─────────────────────────────────── */}
      {mode === 'improve' && (
        <>
          {/* Instruction — compact (one line) while generating, full textarea otherwise */}
          {generating ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground border-b border-border shrink-0 truncate">
              {improveInstruction}
            </div>
          ) : (
            <textarea
              value={improveInstruction}
              onChange={e => setImproveInstruction(e.target.value)}
              placeholder={t('lore.improve_placeholder')}
              className="h-1/5 w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring shrink-0"
              autoFocus
            />
          )}
          {aiControls}
          {/* Improve / Cancel button row */}
          <div className="flex items-center justify-end gap-2 px-2 py-1 border-b border-border shrink-0">
            {!generating && (
              <button
                onClick={() => { setMode('generate'); setImproveInstruction('') }}
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
          {statusRows}
        </>
      )}

      {/* ── Name field (between controls and content) ──────────────────────── */}
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

      {/* ── Content editor ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={content}
          height="100%"
          extensions={[markdown(), ...(wordWrap ? [EditorView.lineWrapping] : [])]}
          theme={resolvedTheme === 'obsidian' ? 'dark' : 'light'}
          onChange={handleContentChange}
          className="h-full text-sm"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: true,
          }}
        />
      </div>

      {/* ── "Improve with AI" button (bottom, only in generate mode when content is present) ── */}
      {mode === 'generate' && hasContent && !generating && (
        <div className="flex justify-start px-2 py-1.5 border-t border-border shrink-0">
          <button
            onClick={() => setMode('improve')}
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            {t('lore.improve_with_ai')}
          </button>
        </div>
      )}
    </div>
  )
}
