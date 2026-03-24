import type { AiGenerationSettings as AiGenerationSettingsDto } from '../../../shared/ai-generation-settings'

export interface GenerateNodeOptions {
  prompt: string
  aiGenerationSettings?: AiGenerationSettingsDto | null
  /** 'generate' (default) | 'improve' */
  mode?: 'generate' | 'improve'
  /** The current content to improve; only used when mode='improve' */
  baseContent?: string
  /** Node ID for template substitution (optional) */
  nodeId?: number
  onThinking?: (status: string, detail?: string) => void
  onPartialJson?: (data: Record<string, unknown>) => void
  onDone?: (data: { response_id?: string; cost_usd_ticks?: number; tokens_input?: number; tokens_output?: number; tokens_total?: number; cached_tokens?: number; reasoning_tokens?: number }) => void
  signal?: AbortSignal
}

export async function generateNodeStream(
  endpoint: string,
  options: GenerateNodeOptions
): Promise<void> {
  const streamId = crypto.randomUUID()
  console.debug(`[generateNodeStream] starting stream ${streamId} for endpoint ${endpoint}`)

  await new Promise<void>((resolve, reject) => {
    const unsub = window.electronAPI.onStreamEvent((event) => {
      if (event.streamId !== streamId) return
      if (event.type === 'thinking') {
        options.onThinking?.(event.data.status as string, event.data.detail as string | undefined)
      } else if (event.type === 'partial_json') {
        options.onPartialJson?.(event.data)
      } else if (event.type === 'done') {
        console.debug(`[generateNodeStream] stream ${streamId} completed`)
        unsub()
        options.onDone?.(event.data as { response_id?: string })
        resolve()
      } else if (event.type === 'error') {
        console.error(`[generateNodeStream] stream ${streamId} error:`, event.data)
        unsub()
        reject(new Error(event.data.message as string))
      }
    })

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        console.debug(`[generateNodeStream] stream ${streamId} aborted by signal`)
        unsub()
        window.electronAPI.abortStream(streamId)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    }

    // Map endpoint URL to IPC endpoint name
    // endpoint is like '/api/ai/generate-lore' or '/api/ai/generate-plan'
    const ipcEndpoint = endpoint.replace('/api/ai/', '')

    // Extract only serializable fields for backend
    const serializableParams = {
      prompt: options.prompt,
      aiGenerationSettings: options.aiGenerationSettings,
      mode: options.mode,
      baseContent: options.baseContent,
      nodeId: options.nodeId,
    }

    window.electronAPI.startStream(streamId, ipcEndpoint, serializableParams).catch((err) => {
      console.error(`[generateNodeStream] startStream failed for ${streamId}:`, err)
      reject(err)
    })
  })
}

export interface GenerateAllOptions {
  regenerateManual?: boolean
  onThinking?: (status: string, detail?: string) => void
  onPartialJson?: (data: Record<string, unknown>) => void
  onDone?: (data: { generated: number; skipped: number }) => void
  signal?: AbortSignal
}

export async function generateAllStream(options: GenerateAllOptions): Promise<void> {
  const streamId = crypto.randomUUID()
  console.debug(`[generateAllStream] starting stream ${streamId}`)

  await new Promise<void>((resolve, reject) => {
    const unsub = window.electronAPI.onStreamEvent((event) => {
      if (event.streamId !== streamId) return
      if (event.type === 'thinking') {
        options.onThinking?.(event.data.status as string, event.data.detail as string | undefined)
      } else if (event.type === 'partial_json') {
        options.onPartialJson?.(event.data)
      } else if (event.type === 'done') {
        console.debug(`[generateAllStream] stream ${streamId} completed`)
        unsub()
        options.onDone?.(event.data as { generated: number; skipped: number })
        resolve()
      } else if (event.type === 'error') {
        console.error(`[generateAllStream] stream ${streamId} error:`, event.data)
        unsub()
        reject(new Error(event.data.message as string))
      }
    })

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        console.debug(`[generateAllStream] stream ${streamId} aborted by signal`)
        unsub()
        window.electronAPI.abortStream(streamId)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    }

    const ipcEndpoint = 'generate-all'
    window.electronAPI.startStream(streamId, ipcEndpoint, {
      regenerateManual: options.regenerateManual ?? false,
    }).catch((err) => {
      console.error(`[generateAllStream] startStream failed for ${streamId}:`, err)
      reject(err)
    })
  })
}
