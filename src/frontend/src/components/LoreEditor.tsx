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

  // Node data
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)

  // Dirty tracking for manual saves
  const [nameDirty, setNameDirty] = useState(false)
  const [contentDirty, setContentDirty] = useState(false)
  const dirty = nameDirty || contentDirty

  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // AI generation state
  const [prompt, setPrompt] = useState('')
  const [includeExistingLore, setIncludeExistingLore] = useState(true)
  const [currentEngine, setCurrentEngine] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [webSearch, setWebSearch] = useState('none')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const [thinkingDone, setThinkingDone] = useState(false)

  // Load node data
  useEffect(() => {
    setLoading(true)
    setNameDirty(false)
    setContentDirty(false)
    fetch(`/api/lore/${nodeId}`)
      .then(r => r.json())
      .then((node: { name: string; content: string | null }) => {
        setName(node.name)
        setContent(node.content ?? '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [nodeId])

  // Load AI engine config
  useEffect(() => {
    fetch('/api/ai/config')
      .then(r => r.json())
      .then((data: { current_engine?: string | null; [key: string]: unknown }) => {
        const engine = data.current_engine ?? null
        setCurrentEngine(engine)
        if (!engine) return
        const engineData = data[engine] as {
          available_models?: string[]
          last_model?: string | null
        } | undefined
        const models = engineData?.available_models ?? []
        setAvailableModels(models)
        const last = engineData?.last_model
        setSelectedModel(last && models.includes(last) ? last : (models[0] ?? ''))
      })
      .catch(() => {})
  }, [])

  // Clear timers on unmount
  useEffect(() => () => {
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
  }, [])

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
          dispatchLoreNodeSaved({ id: nodeId, wordCount: data.word_count, charCount: data.char_count, byteCount: data.byte_count, aiSyncInfo: data.ai_sync_info ?? null })
        }).catch(() => setContentDirty(false))
    }, 1000)
  }

  async function handleGenerate() {
    if (!prompt.trim()) return
    // Cancel any pending manual-edit saves
    if (nameTimerRef.current) { clearTimeout(nameTimerRef.current); nameTimerRef.current = null }
    if (contentTimerRef.current) { clearTimeout(contentTimerRef.current); contentTimerRef.current = null }
    setNameDirty(false)
    setContentDirty(false)
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
        prompt,
        includeExistingLore,
        model: selectedModel || undefined,
        webSearch,
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
          prompt: prompt.trim(),
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

  const engineDef = BUILTIN_ENGINES.find(e => e.id === currentEngine)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <input
          className="flex-1 text-base font-semibold bg-transparent border-b border-transparent focus:border-primary focus:outline-none px-0.5 transition-colors"
          value={name}
          onChange={handleNameChange}
          placeholder="Node name"
          aria-label="Node name"
        />
        <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
          {dirty ? 'Saving…' : 'Saved'}
        </span>
      </div>

      {/* Prompt textarea */}
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Describe what to generate…"
        className="h-1/5 w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring shrink-0"
      />

      {/* AI controls row */}
      <div className="flex items-center gap-3 px-2 py-1.5 border-b border-border shrink-0 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={includeExistingLore}
            onChange={e => setIncludeExistingLore(e.target.checked)}
            className="accent-primary"
          />
          Include existing lore
        </label>

        {engineDef?.webSearch === 'contextSize' && (
          <select
            value={webSearch}
            onChange={e => setWebSearch(e.target.value)}
            className="text-sm border border-border rounded px-2 py-0.5 bg-background"
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
            />
            Web search
          </label>
        )}

        {availableModels.length > 0 && (
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            className="text-sm border border-border rounded px-2 py-0.5 bg-background max-w-[200px]"
            title="Model"
          >
            {availableModels.map(m => (
              <option key={m} value={m}>{shortModelName(m)}</option>
            ))}
          </select>
        )}

        <button
          onClick={() => void handleGenerate()}
          disabled={generating || !prompt.trim()}
          className="ml-auto px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {generating ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {/* Thinking status row */}
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

      {/* Error banner */}
      {genError && (
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0">
          {genError}
        </div>
      )}

      {/* Content editor */}
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
    </div>
  )
}
