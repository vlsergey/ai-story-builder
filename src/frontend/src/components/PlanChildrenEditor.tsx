import React, { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useLocale } from '../lib/locale'
import { BUILTIN_ENGINES } from '../../../shared/ai-engines.js'
import { generatePlanChildrenStream } from '../lib/generate-plan-children-stream'
import { dispatchPlanTreeRefresh } from '../lib/plan-events'

interface PlanChildrenEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
}

interface ProposedChild {
  name: string
  description: string
}

type EditorMode = 'idle' | 'streaming' | 'review'

function shortModelName(modelId: string): string {
  return modelId.replace(/^gpt:\/\/[^/]+\//, '')
}

export default function PlanChildrenEditor({ nodeId, panelApi }: PlanChildrenEditorProps) {
  const { t } = useLocale()

  const [parentTitle, setParentTitle] = useState('')
  const [parentContent, setParentContent] = useState('')
  const [loading, setLoading] = useState(true)

  const [mode, setMode] = useState<EditorMode>('idle')
  const [prompt, setPrompt] = useState('')
  const [proposedChildren, setProposedChildren] = useState<ProposedChild[]>([])
  const [parentDescription, setParentDescription] = useState('')

  // AI config
  const [currentEngine, setCurrentEngine] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [webSearch, setWebSearch] = useState('none')

  // Generation state
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const [thinkingDone, setThinkingDone] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // "Replace all" confirmation state
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const [applying, setApplying] = useState(false)

  const partialRef = useRef<Record<string, unknown>>({})

  // Load node on mount
  useEffect(() => {
    fetch(`/api/plan/nodes/${nodeId}`)
      .then(r => r.json() as Promise<{ title: string; content: string | null }>)
      .then(node => {
        setParentTitle(node.title)
        setParentContent(node.content ?? '')
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
        const engineData = data[engine] as { available_models?: string[]; last_model?: string | null } | undefined
        const models = engineData?.available_models ?? []
        setAvailableModels(models)
        const last = engineData?.last_model
        setSelectedModel(last && models.includes(last) ? last : (models[0] ?? ''))
      })
      .catch(() => {})
  }, [])

  const engineDef = BUILTIN_ENGINES.find(e => e.id === currentEngine)

  async function handleGenerate() {
    if (!prompt.trim()) return
    setMode('streaming')
    setGenError(null)
    setThinkingStatus(null)
    setThinkingDetail(null)
    setThinkingDone(false)
    partialRef.current = {}

    let finalItems: ProposedChild[] = []
    let finalDescription = ''

    try {
      await generatePlanChildrenStream({
        prompt: prompt.trim(),
        parentTitle,
        parentContent,
        model: selectedModel || undefined,
        webSearch,
        onThinking: (status, detail) => {
          if (status === 'done') setThinkingDone(true)
          else { setThinkingStatus(status); setThinkingDone(false) }
          setThinkingDetail(detail ?? null)
        },
        onPartialJson: (partial) => {
          partialRef.current = partial
          if (typeof partial.description === 'string') finalDescription = partial.description
          if (Array.isArray(partial.items)) {
            finalItems = (partial.items as { name?: string; description?: string }[]).map(item => ({
              name: typeof item.name === 'string' ? item.name : '',
              description: typeof item.description === 'string' ? item.description : '',
            }))
          }
        },
        onDone: () => {},
      })

      setProposedChildren(finalItems)
      setParentDescription(finalDescription)

      // Save last-used model
      if (selectedModel && currentEngine) {
        void fetch('/api/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine: currentEngine, fields: { last_model: selectedModel } }),
        })
      }

      setMode('review')
    } catch (e) {
      setGenError(String(e))
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
            title: child.name,
            content: child.description,
            position: i,
          }),
        })
      }

      dispatchPlanTreeRefresh()
      setMode('idle')
      setProposedChildren([])
      setPrompt('')
    } catch (e) {
      setGenError(String(e))
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
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0">
          {genError}
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

          {/* AI controls */}
          <div className="flex items-center gap-3 flex-wrap">
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
              <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer">
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
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="ml-auto px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('plan.generate_children')}
            </button>
          </div>
        </div>
      )}

      {/* ── STREAMING mode ────────────────────────────────────────────────────── */}
      {mode === 'streaming' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto p-3 gap-2">
          {thinkingStatus !== null && (
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
          )}
          <div className="text-sm text-muted-foreground italic">Generating sub-items…</div>
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
                  value={child.name}
                  onChange={e => {
                    const next = [...proposedChildren]
                    next[i] = { ...next[i], name: e.target.value }
                    setProposedChildren(next)
                  }}
                  placeholder="Title"
                />
                <textarea
                  className="w-full text-sm resize-none border border-border rounded bg-background p-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={4}
                  value={child.description}
                  onChange={e => {
                    const next = [...proposedChildren]
                    next[i] = { ...next[i], description: e.target.value }
                    setProposedChildren(next)
                  }}
                  placeholder="Description"
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
