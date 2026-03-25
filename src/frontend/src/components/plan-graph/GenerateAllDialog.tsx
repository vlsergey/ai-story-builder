import React, { useState, useRef } from 'react'
import { useLocale } from '../../lib/locale'
import { generateAllStream } from '../../lib/generate-node-stream'

interface GenerateAllDialogProps {
  onClose: () => void
}

type LogEntry = {
  type: 'info' | 'success' | 'warning' | 'error'
  message: string
  timestamp: Date
}

export default function GenerateAllDialog({ onClose }: GenerateAllDialogProps) {
  const { t } = useLocale()
  const [regenerateManual, setRegenerateManual] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [generatedCount, setGeneratedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [queueSize, setQueueSize] = useState(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, { type, message, timestamp: new Date() }])
  }

  const handleStart = async () => {
    if (isGenerating) return
    setIsGenerating(true)
    setLogs([])
    setGeneratedCount(0)
    setSkippedCount(0)
    setQueueSize(0)

    const ac = new AbortController()
    abortControllerRef.current = ac

    try {
      await generateAllStream({
        regenerateManual,
        onThinking: (status, detail) => {
          addLog('info', detail ? `${status}: ${detail}` : status)
          if (status === 'processing') {
            // detail includes nodeId and queueSize? we can parse
            // but we'll rely on partial_json for precise updates
          }
        },
        onPartialJson: (data) => {
          const { type, nodeId, generated, skipped, queueSize: qSize, reason } = data as any
          if (type === 'node_generated') {
            setGeneratedCount(generated)
            const message = reason ? `Node ${nodeId} generated: ${reason}` : `Node ${nodeId} generated`
            addLog('success', message)
          } else if (type === 'node_skipped') {
            setSkippedCount(skipped)
            const message = reason ? `Node ${nodeId} skipped: ${reason}` : `Node ${nodeId} skipped`
            addLog('warning', message)
          } else if (type === 'node_error') {
            const message = reason ? `Node ${nodeId} generation error: ${reason}` : `Node ${nodeId} generation error`
            addLog('error', message)
          }
          if (qSize !== undefined) setQueueSize(qSize)
        },
        onDone: (data) => {
          addLog('success', `Generation completed: ${data.generated} generated, ${data.skipped} skipped`)
          setGeneratedCount(data.generated)
          setSkippedCount(data.skipped)
          setIsGenerating(false)
          abortControllerRef.current = null
        },
        signal: ac.signal,
      })
    } catch (error: any) {
      if (error.name === 'AbortError') {
        addLog('warning', 'Generation aborted by user')
      } else {
        addLog('error', `Error: ${error.message}`)
      }
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-[640px] max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{t('planGraph.generateAll.title')}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="regenerateManual"
              checked={regenerateManual}
              onChange={(e) => setRegenerateManual(e.target.checked)}
              disabled={isGenerating}
            />
            <label htmlFor="regenerateManual" className="text-sm">
              Regenerate manual nodes
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded p-3">
              <div className="text-sm text-muted-foreground">Generated</div>
              <div className="text-2xl font-bold">{generatedCount}</div>
            </div>
            <div className="border rounded p-3">
              <div className="text-sm text-muted-foreground">Skipped</div>
              <div className="text-2xl font-bold">{skippedCount}</div>
            </div>
            <div className="border rounded p-3">
              <div className="text-sm text-muted-foreground">Queue size</div>
              <div className="text-2xl font-bold">{queueSize}</div>
            </div>
            <div className="border rounded p-3">
              <div className="text-sm text-muted-foreground">Status</div>
              <div className="text-2xl font-bold">{isGenerating ? 'Running' : 'Idle'}</div>
            </div>
          </div>

          <div className="border rounded">
            <div className="p-2 border-b text-sm font-medium">Logs</div>
            <div className="max-h-48 overflow-y-auto p-2">
              {logs.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">No logs yet</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className={`text-sm ${log.type === 'error' ? 'text-red-600' : log.type === 'warning' ? 'text-amber-600' : log.type === 'success' ? 'text-green-600' : ''}`}>
                    {log.timestamp.toLocaleTimeString()} {log.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          {isGenerating ? (
            <button
              onClick={handleAbort}
              className="px-3 py-1.5 text-sm rounded border border-border bg-red-600 text-white hover:bg-red-700"
            >
              Abort
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted"
              >
                Close
              </button>
              <button
                onClick={handleStart}
                disabled={isGenerating}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Start Generation
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
