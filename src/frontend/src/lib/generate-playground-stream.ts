import type { AiSettings } from '../../../shared/ai-settings.js'

export interface GeneratePlaygroundOptions {
  systemPrompt?: string
  prompt: string
  settings?: AiSettings
  onThinking?: (status: string, detail?: string) => void
  onPartialJson?: (data: Record<string, unknown>) => void
  onDone?: (data: { response_id?: string }) => void
  signal?: AbortSignal
}

export async function generatePlaygroundStream(options: GeneratePlaygroundOptions): Promise<void> {
  const streamId = crypto.randomUUID()

  await new Promise<void>((resolve, reject) => {
    const unsub = window.electronAPI!.onStreamEvent((event) => {
      if (event.streamId !== streamId) return
      if (event.type === 'thinking') {
        options.onThinking?.(event.data.status as string, event.data.detail as string | undefined)
      } else if (event.type === 'partial_json') {
        options.onPartialJson?.(event.data as Record<string, unknown>)
      } else if (event.type === 'done') {
        unsub()
        options.onDone?.(event.data as { response_id?: string })
        resolve()
      } else if (event.type === 'error') {
        unsub()
        reject(new Error(event.data.message as string))
      }
    })

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        unsub()
        window.electronAPI!.abortStream(streamId)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    }

    window.electronAPI!.startStream(streamId, 'generate-playground', {
      systemPrompt: options.systemPrompt,
      prompt: options.prompt,
      settings: options.settings,
    }).catch(reject)
  })
}
