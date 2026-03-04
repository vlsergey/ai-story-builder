import React, { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { useTheme } from '../lib/theme/theme-provider'
import { useEditorSettings } from '../lib/editor-settings'
import { LORE_TREE_REFRESH_EVENT } from '../lib/lore-events'

interface LoreWizardProps {
  parentNodeId: number
  parentNodeName: string
  panelApi?: { setTitle: (title: string) => void }
}

/** Strips the `gpt://folder_id/` prefix from Yandex model URIs for display. */
function shortModelName(modelId: string): string {
  return modelId.replace(/^gpt:\/\/[^/]+\//, '')
}

export default function LoreWizard({ parentNodeId, parentNodeName, panelApi }: LoreWizardProps) {
  const { resolvedTheme } = useTheme()
  const { wordWrap } = useEditorSettings()

  const [prompt, setPrompt] = useState('')
  const [includeExistingLore, setIncludeExistingLore] = useState(true)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [content, setContent] = useState('')
  const [name, setName] = useState('New lore item')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    panelApi?.setTitle(`AI Wizard → ${parentNodeName}`)
  }, [parentNodeName])

  // Load the cached model list for the active engine
  useEffect(() => {
    fetch('/api/ai/config')
      .then(r => r.json())
      .then((data: { current_engine?: string | null; [key: string]: unknown }) => {
        const engine = data.current_engine
        if (!engine) return
        const engineData = data[engine] as { available_models?: string[] } | undefined
        const models = engineData?.available_models ?? []
        setAvailableModels(models)
        if (models.length > 0) setSelectedModel(models[0])
      })
      .catch(() => {})
  }, [])

  async function handleGenerate() {
    if (!prompt.trim()) return
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/generate-lore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          includeExistingLore,
          ...(selectedModel ? { model: selectedModel } : {}),
        }),
      })
      const data = await res.json() as { content?: string; error?: string }
      if (res.ok) {
        setContent(data.content ?? '')
      } else {
        setError(data.error ?? 'Unknown error')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const r1 = await fetch('/api/lore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: parentNodeId, name: name.trim() }),
      })
      const { id } = await r1.json() as { id: number }
      await fetch(`/api/lore/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      window.dispatchEvent(new Event(LORE_TREE_REFRESH_EVENT))
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Prompt textarea */}
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Опишите, какой lore item нужно создать…"
        className="h-1/4 w-full resize-none border-b border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring shrink-0"
      />

      {/* Controls row */}
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

      {/* Error banner */}
      {error && (
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0">
          {error}
        </div>
      )}

      {/* CodeMirror editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={content}
          height="100%"
          extensions={[markdown(), ...(wordWrap ? [EditorView.lineWrapping] : [])]}
          theme={resolvedTheme === 'obsidian' ? 'dark' : 'light'}
          onChange={setContent}
          className="h-full text-sm"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: true,
          }}
        />
      </div>

      {/* Save row */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border shrink-0">
        <span className="text-sm text-muted-foreground shrink-0">Name:</span>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 h-7 text-sm bg-background border border-input rounded px-2 focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="New lore item"
        />
        <button
          onClick={() => void handleSave()}
          disabled={saving || !name.trim()}
          className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
