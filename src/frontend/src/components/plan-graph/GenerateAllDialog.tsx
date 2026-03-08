import React, { useEffect, useState } from 'react'
import { useLocale } from '../../lib/locale'

interface PreviewNode {
  id: number
  title: string
  wordCount: number
  hasContent: boolean
}

interface GenerateAllDialogProps {
  onClose: () => void
}

export default function GenerateAllDialog({ onClose }: GenerateAllDialogProps) {
  const { t } = useLocale()
  const [preview, setPreview] = useState<PreviewNode[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch('/api/plan/graph/generate-all/preview')
      .then(r => r.json())
      .then((data: { nodes: PreviewNode[] }) => {
        setPreview(data.nodes)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const totalWords = preview?.reduce((s, n) => s + n.wordCount, 0) ?? 0
  const withContent = preview?.filter(n => n.hasContent).length ?? 0

  async function handleGenerate() {
    setGenerating(true)
    setProgress([])

    const resp = await fetch('/api/plan/graph/generate-all', { method: 'POST' })
    if (!resp.ok || !resp.body) {
      setGenerating(false)
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; message?: string }
            if (evt.type === 'progress' && evt.message) {
              setProgress(prev => [...prev, evt.message!])
            } else if (evt.type === 'done') {
              setDone(true)
            }
          } catch { /* ignore */ }
        }
      }
    }
    setGenerating(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{t('planGraph.generateAll.title')}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

          {!loading && preview && !generating && !done && (
            <p className="text-sm">
              {t('planGraph.generateAll.body')
                .replace('{{count}}', String(preview.length))
                .replace('{{words}}', String(totalWords))
                .replace('{{bytes}}', '-')}
            </p>
          )}

          {withContent > 0 && !generating && !done && (
            <p className="text-sm text-destructive mt-2 font-medium">
              {withContent} nodes have existing content that will be overwritten.
            </p>
          )}

          {(generating || done) && (
            <div className="space-y-1">
              {progress.map((msg, i) => (
                <div key={i} className="text-sm text-muted-foreground">{msg}</div>
              ))}
              {done && <div className="text-sm text-green-600 font-medium">Done!</div>}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted"
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              onClick={() => void handleGenerate()}
              disabled={generating || loading}
              className="px-3 py-1.5 text-sm rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {generating ? 'Generating…' : t('planGraph.generateAll.proceed')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
