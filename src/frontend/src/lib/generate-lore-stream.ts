export interface GenerateLoreOptions {
  prompt: string
  includeExistingLore?: boolean
  model?: string
  webSearch?: string
  onThinking?: (status: string) => void
  onPartialJson?: (data: Record<string, unknown>) => void
  signal?: AbortSignal
}

export async function generateLoreStream(options: GenerateLoreOptions): Promise<void> {
  const response = await fetch('/api/ai/generate-lore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: options.prompt,
      includeExistingLore: options.includeExistingLore,
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
        if (currentEvent === 'thinking') options.onThinking?.(data.status as string)
        else if (currentEvent === 'partial_json') options.onPartialJson?.(data)
        else if (currentEvent === 'error') throw new Error(data.message as string)
        currentEvent = ''
      }
    }
  }
}
