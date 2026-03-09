import type { AiSettings } from '../../../shared/ai-settings.js'

export interface GeneratePlanChildrenOptions {
  prompt: string
  parentTitle: string
  parentContent: string
  isRoot?: boolean
  settings?: AiSettings
  onThinking?: (status: string, detail?: string) => void
  onPartialJson?: (data: Record<string, unknown>) => void
  onDone?: (data: { response_id?: string }) => void
  signal?: AbortSignal
}

export async function generatePlanChildrenStream(options: GeneratePlanChildrenOptions): Promise<void> {
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
        const err = new Error(event.data.message as string)
        if (event.data.stack) err.stack = event.data.stack as string
        reject(err)
      }
    })

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        unsub()
        window.electronAPI!.abortStream(streamId)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    }

    window.electronAPI!.startStream(streamId, 'generate-plan-children', {
      prompt: options.prompt,
      parentTitle: options.parentTitle,
      parentContent: options.parentContent,
      isRoot: options.isRoot,
      settings: options.settings,
    }).catch(reject)
  })
}
