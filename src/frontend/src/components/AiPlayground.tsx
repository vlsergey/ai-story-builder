import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, Clipboard, Trash2 } from 'lucide-react'
import { generatePlaygroundStream } from '../lib/generate-playground-stream'
import type { AiGenerationSettings } from '../../../shared/ai-generation-settings'
import AiGenerationSettingsForm from './AiGenerationSettingsForm'

export default function AiPlayground() {
  const [aiGenerationSettings, setAiGenerationSettings] = useState<AiGenerationSettings | null>()

  const [systemPrompt, setSystemPrompt] = useState('')
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const [thinkingDone, setThinkingDone] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const responseRef = useRef<HTMLPreElement>(null)

  // Auto-scroll response to bottom during streaming
  useEffect(() => {
    if (generating && responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight
    }
  }, [response, generating])

  async function handleGenerate() {
    if (!prompt.trim() || generating) return
    abortRef.current = new AbortController()
    setGenerating(true)
    setError(null)
    setResponse('')
    setThinkingStatus(null)
    setThinkingDetail(null)
    setThinkingDone(false)

    try {
      await generatePlaygroundStream({
        systemPrompt: systemPrompt.trim() || undefined,
        prompt: prompt.trim(),
        aiGenerationSettings: aiGenerationSettings || {},
        signal: abortRef.current.signal,
        onThinking: (status, detail) => {
          if (status === 'done') setThinkingDone(true)
          else { setThinkingStatus(status); setThinkingDone(false) }
          setThinkingDetail(detail ?? null)
        },
        onPartialJson: (partial) => {
          if (typeof partial.content === 'string') setResponse(partial.content)
        },
        onDone: () => {},
      })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setGenerating(false)
      abortRef.current = null
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  function handleCopyResponse() {
    if (response) void navigator.clipboard.writeText(response)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* Settings bar */}
      <AiGenerationSettingsForm
        value={aiGenerationSettings}
        onChange={setAiGenerationSettings}
      />

      {/* Main area: split vertically — input top, output bottom */}
      <div className="flex flex-col flex-1 min-h-0 divide-y divide-border">

        {/* Input section */}
        <div className="flex flex-col shrink-0 max-h-[50%]">
          {/* System prompt */}
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="System prompt (optional)"
            disabled={generating}
            rows={3}
            className="w-full resize-none border-b border-border bg-muted/30 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60 font-mono"
          />
          {/* User prompt + send button */}
          <div className="flex gap-2 p-2 border-b border-border items-end">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !generating) { e.preventDefault(); void handleGenerate() } }}
              placeholder="User prompt… (Ctrl+Enter to send)"
              disabled={generating}
              rows={4}
              className="flex-1 resize-none bg-background border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
            <div className="flex flex-col gap-1 shrink-0">
              {generating ? (
                <button
                  onClick={handleStop}
                  className="px-3 py-1.5 text-sm rounded border border-destructive text-destructive hover:bg-destructive/10"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={void handleGenerate}
                  disabled={!prompt.trim()}
                  className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Output section */}
        <div className="flex flex-col flex-1 min-h-0">
          {/* Output header */}
          <div className="flex items-center gap-2 px-2 py-1 border-b border-border shrink-0 bg-muted/20">
            <span className="text-xs text-muted-foreground font-medium flex-1">Response</span>
            {/* Thinking status */}
            {thinkingStatus !== null && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {thinkingDone
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  : <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                <span className="truncate max-w-[200px]" title={thinkingDetail ?? undefined}>
                  {thinkingDone ? 'Done' : (thinkingDetail ?? thinkingStatus)}
                </span>
              </div>
            )}
            {generating && thinkingStatus === null && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
            )}
            {response && (
              <>
                <button
                  onClick={handleCopyResponse}
                  title="Copy to clipboard"
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setResponse('')}
                  title="Clear response"
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-2 py-1.5 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0">
              {error}
            </div>
          )}

          {/* Response text */}
          <pre
            ref={responseRef}
            className="flex-1 min-h-0 overflow-auto p-3 text-sm font-mono whitespace-pre-wrap wrap-break-word leading-relaxed"
          >
            {response || <span className="text-muted-foreground/50 select-none">Response will appear here…</span>}
          </pre>
        </div>
      </div>
    </div>
  )
}
