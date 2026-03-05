export interface GeneratePlanChildrenOptions {
  prompt: string
  parentTitle: string
  parentContent: string
  model?: string
  webSearch?: string
  onThinking?: (status: string, detail?: string) => void
  onPartialJson?: (data: Record<string, unknown>) => void
  onDone?: (data: { response_id?: string }) => void
  signal?: AbortSignal
}

export async function generatePlanChildrenStream(options: GeneratePlanChildrenOptions): Promise<void> {
  const response = await fetch('/api/ai/generate-plan-children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: options.prompt,
      parentTitle: options.parentTitle,
      parentContent: options.parentContent,
      model: options.model,
      webSearch: options.webSearch,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const err = await response.json() as { error?: string }
    throw new Error(err.error ?? `HTTP ${response.status}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim() }
      else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6)) as Record<string, unknown>
        if (currentEvent === 'thinking') options.onThinking?.(data.status as string, data.detail as string | undefined)
        else if (currentEvent === 'partial_json') options.onPartialJson?.(data)
        else if (currentEvent === 'done') options.onDone?.(data as { response_id?: string })
        else if (currentEvent === 'error') {
          const err = new Error(data.message as string)
          if (data.stack) err.stack = data.stack as string
          throw err
        }
        currentEvent = ''
      }
    }
  }
}
