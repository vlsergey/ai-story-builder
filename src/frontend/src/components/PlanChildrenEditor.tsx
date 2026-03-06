import React, { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useLocale } from '../lib/locale'
import { generatePlanChildrenStream } from '../lib/generate-plan-children-stream'
import { dispatchPlanTreeRefresh } from '../lib/plan-events'
import AiGenerationSettings from './AiGenerationSettings'
import type { AiSettings } from '../../../shared/ai-settings.js'

interface PlanChildrenEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
}

interface ProposedChild {
  title: string
  content: string
}

type EditorMode = 'idle' | 'streaming' | 'review'

export default function PlanChildrenEditor({ nodeId, panelApi }: PlanChildrenEditorProps) {
  const { t } = useLocale()

  const [parentTitle, setParentTitle] = useState('')
  const [parentContent, setParentContent] = useState('')
  const [isRoot, setIsRoot] = useState(false)
  const [loading, setLoading] = useState(true)

  const [mode, setMode] = useState<EditorMode>('idle')
  const [prompt, setPrompt] = useState('')
  const [proposedChildren, setProposedChildren] = useState<ProposedChild[]>([])
  const [parentDescription, setParentDescription] = useState('')

  // AI config
  const [currentEngine, setCurrentEngine] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [aiSettings, setAiSettings] = useState<AiSettings>({ webSearch: 'none', includeExistingLore: true, maxTokens: 16384 })

  // Generation state
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const [thinkingDone, setThinkingDone] = useState(false)
  const [genError, setGenError] = useState<{ message: string; stack?: string } | null>(null)

  // "Replace all" confirmation state
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const [applying, setApplying] = useState(false)

  // Live partial results shown during streaming
  const [streamingItems, setStreamingItems] = useState<ProposedChild[]>([])
  const [streamingDescription, setStreamingDescription] = useState('')

  // Load node on mount
  useEffect(() => {
    fetch(`/api/plan/nodes/${nodeId}`)
      .then(r => r.json() as Promise<{ title: string; content: string | null; parent_id: number | null }>)
      .then(node => {
        setParentTitle(node.title)
        setParentContent(node.content ?? '')
        setIsRoot(node.parent_id === null)
        panelApi?.setTitle(`Split: ${node.title}`)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [nodeId])

  // Load AI config
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

  async function handleGenerate() {
    if (!prompt.trim()) return
    setMode('streaming')
    setGenError(null)
    setThinkingStatus(null)
    setThinkingDetail(null)
    setThinkingDone(false)
    setStreamingItems([])
    setStreamingDescription('')

    let finalItems: ProposedChild[] = []
    let finalDescription = ''

    try {
      await generatePlanChildrenStream({
        prompt: prompt.trim(),
        parentTitle,
        parentContent,
        isRoot,
        settings: aiSettings,
        onThinking: (status, detail) => {
          if (status === 'done') setThinkingDone(true)
          else { setThinkingStatus(status); setThinkingDone(false) }
          setThinkingDetail(detail ?? null)
        },
        onPartialJson: (partial) => {
          if (typeof partial.overview === 'string') {
            finalDescription = partial.overview
            setStreamingDescription(partial.overview)
          }
          if (Array.isArray(partial.items)) {
            finalItems = (partial.items as { title?: string; content?: string }[]).map(item => ({
              title: typeof item.title === 'string' ? item.title : '',
              content: typeof item.content === 'string' ? item.content : '',
            }))
            setStreamingItems(finalItems)
          }
        },
        onDone: () => {},
      })

      setProposedChildren(finalItems)
      setParentDescription(finalDescription)

      // Save last-used model and max tokens
      if (currentEngine) {
        void fetch('/api/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine: currentEngine, fields: { settings: aiSettings } }),
        })
      }

      setMode('review')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error && e.stack ? e.stack : undefined
      console.error('[PlanChildrenEditor] generation error:', e)
      setGenError({ message, stack })
      setMode('idle')
    }
  }

  async function applyChildren(replaceExisting: boolean) {
    setApplying(true)
    try {
      if (replaceExisting) {
        // Delete all existing children
        const tree = await fetch(`/api/plan/nodes`)
          .then(r => r.json() as Promise<Array<{ id: number; parent_id: number | null; children?: unknown[] }>>)
        // Find children of this node
        function findNode(nodes: Array<{ id: number; parent_id: number | null; children?: unknown[] }>, id: number): { id: number; children?: unknown[] } | null {
          for (const n of nodes) {
            if (n.id === id) return n
            if (n.children?.length) {
              const found = findNode(n.children as typeof nodes, id)
              if (found) return found
            }
          }
          return null
        }
        const parentNode = findNode(tree, nodeId)
        const existingChildren = (parentNode?.children ?? []) as Array<{ id: number }>
        await Promise.all(existingChildren.map(c =>
          fetch(`/api/plan/nodes/${c.id}`, { method: 'DELETE' })
        ))
      }

      // Create new children
      for (let i = 0; i < proposedChildren.length; i++) {
        const child = proposedChildren[i]
        await fetch('/api/plan/nodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parent_id: nodeId,
            title: child.title,
            content: child.content,
            position: i,
          }),
        })
      }

      dispatchPlanTreeRefresh()
      setMode('idle')
      setProposedChildren([])
      setPrompt('')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setGenError({ message })
    } finally {
      setApplying(false)
      setShowReplaceConfirm(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="text-sm text-muted-foreground">Split into sub-items: <strong>{parentTitle}</strong></div>
      </div>

      {/* Error */}
      {genError && (
        <div className="px-2 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0 space-y-1">
          <div className="font-medium">{genError.message}</div>
          {genError.stack && (
            <details className="opacity-70">
              <summary className="cursor-pointer select-none">Stack trace</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] leading-tight">{genError.stack}</pre>
            </details>
          )}
        </div>
      )}

      {/* ── IDLE mode ─────────────────────────────────────────────────────────── */}
      {mode === 'idle' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto p-3 gap-3">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={t('plan.split_placeholder')}
            className="w-full h-[20vh] min-h-[80px] resize-none border border-border rounded bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <AiGenerationSettings
            engineId={currentEngine}
            availableModels={availableModels}
            settings={aiSettings}
            onSettingsChange={setAiSettings}
            className="flex items-center gap-3 flex-wrap"
          />
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="self-end px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('plan.generate_children')}
          </button>
        </div>
      )}

      {/* ── STREAMING mode ────────────────────────────────────────────────────── */}
      {mode === 'streaming' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Thinking status bar */}
          <div className="shrink-0 px-3 py-2 border-b border-border">
            {thinkingStatus !== null ? (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
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
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>Generating sub-items…</span>
              </div>
            )}
          </div>

          {/* Live partial results */}
          <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
            {streamingDescription && (
              <div className="p-2 bg-muted rounded text-sm text-muted-foreground">{streamingDescription}</div>
            )}
            {streamingItems.length > 0 && (
              <div className="text-xs text-muted-foreground font-medium">{streamingItems.length} sub-items so far…</div>
            )}
            {streamingItems.map((item, i) => (
              <div key={i} className="border border-border rounded p-3 space-y-1 opacity-80">
                <div className="text-sm font-semibold">{item.title || <span className="italic text-muted-foreground">…</span>}</div>
                {item.content && (
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap">{item.content}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── REVIEW mode ───────────────────────────────────────────────────────── */}
      {mode === 'review' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
            {parentDescription && (
              <div className="p-2 bg-muted rounded text-sm">
                <div className="text-xs text-muted-foreground mb-1 font-medium">Parent node overview</div>
                <div>{parentDescription}</div>
              </div>
            )}
            <div className="text-sm font-medium text-muted-foreground">{proposedChildren.length} sub-items:</div>
            {proposedChildren.map((child, i) => (
              <div key={i} className="border border-border rounded p-3 space-y-2">
                <input
                  className="w-full text-sm font-semibold bg-transparent border-b border-transparent focus:border-primary focus:outline-none px-0.5"
                  value={child.title}
                  onChange={e => {
                    const next = [...proposedChildren]
                    next[i] = { ...next[i], title: e.target.value }
                    setProposedChildren(next)
                  }}
                  placeholder="Title"
                />
                <textarea
                  className="w-full text-sm resize-none border border-border rounded bg-background p-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={4}
                  value={child.content}
                  onChange={e => {
                    const next = [...proposedChildren]
                    next[i] = { ...next[i], content: e.target.value }
                    setProposedChildren(next)
                  }}
                  placeholder="Content"
                />
              </div>
            ))}
          </div>

          {/* Action bar */}
          <div className="shrink-0 border-t border-border p-2 flex items-center gap-2 justify-end">
            <button
              onClick={() => setMode('idle')}
              disabled={applying}
              className="px-3 py-1 text-sm rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-50"
            >
              Back
            </button>

            <button
              onClick={() => void applyChildren(false)}
              disabled={applying || proposedChildren.length === 0}
              className="px-3 py-1 text-sm rounded border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? 'Applying…' : t('plan.add_to_existing')}
            </button>

            {showReplaceConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-destructive">{t('plan.replace_all_confirm')}</span>
                <button
                  onClick={() => void applyChildren(true)}
                  disabled={applying}
                  className="px-3 py-1 text-sm rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setShowReplaceConfirm(false)}
                  className="px-3 py-1 text-sm rounded border border-border hover:bg-muted text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowReplaceConfirm(true)}
                disabled={applying || proposedChildren.length === 0}
                className="px-3 py-1 text-sm rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('plan.replace_all')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
