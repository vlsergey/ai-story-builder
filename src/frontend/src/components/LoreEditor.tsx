import React, { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { useTheme } from '../lib/theme/theme-provider'
import { useEditorSettings } from '../lib/editor-settings'
import { dispatchLoreNodeSaved } from '../lib/lore-events'

interface LoreEditorProps {
  nodeId: number
  /** Dockview panel API — used to update the tab title on rename */
  panelApi?: { setTitle: (title: string) => void }
}

export default function LoreEditor({ nodeId, panelApi }: LoreEditorProps) {
  const { resolvedTheme } = useTheme()
  const { wordWrap } = useEditorSettings()
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [nameDirty, setNameDirty] = useState(false)
  const [contentDirty, setContentDirty] = useState(false)
  const dirty = nameDirty || contentDirty

  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        body: JSON.stringify({ content: value }),
      }).then(r => r.json())
        .then((data: { ok: boolean; word_count: number; char_count: number; byte_count: number; ai_sync_info?: Record<string, { last_synced_at: string; file_id?: string; content_updated_at?: string }> | null }) => {
          setContentDirty(false)
          dispatchLoreNodeSaved({ id: nodeId, wordCount: data.word_count, charCount: data.char_count, byteCount: data.byte_count, aiSyncInfo: data.ai_sync_info ?? null })
        }).catch(() => setContentDirty(false))
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
