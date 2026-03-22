import type { AiGenerationSettings } from '../../shared/ai-generation-settings.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

export async function generatePlayground(
  params: { systemPrompt?: string; prompt?: string; settings?: AiGenerationSettings; includeExistingLore?: boolean },
  onThinking: (status: string, detail?: string) => void,
  onPartialJson: (data: Record<string, unknown>) => void,
): Promise<{ response_id?: string }> {
  const { systemPrompt, prompt, settings = {}, includeExistingLore = false } = params

  if (!prompt?.trim()) throw makeError('prompt is required', 400)

  let engine: string | undefined
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.get('current_backend') || undefined
    if (!engine) throw makeError('no AI engine configured', 400)

    if (includeExistingLore && engine) {
      const repo = new LoreNodeRepository()
      const nodes = repo.getAllWithAiSyncInfo()
      for (const node of nodes) {
        try {
          const info = JSON.parse(node.ai_sync_info!) as Record<string, { file_id?: string }>
          const fileId = info[engine]?.file_id
          if (fileId) engineFileIds.push(fileId)
        } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    if (e.status) throw e
    throw makeError('failed to read project settings: ' + String(e), 500)
  }

  const adapter = getEngineAdapter(engine)
  if (!adapter) throw makeError(`Playground is not supported for engine '${engine}'`, 400)

  let accumulated = ''
  let lastEmitted = ''
  const onDelta = (chunk: string) => {
    accumulated += chunk
    if (accumulated === lastEmitted) return
    lastEmitted = accumulated
    onPartialJson({ content: accumulated })
  }

  const { response_id } = await adapter.generateResponse(
    {
      prompt: prompt.trim(),
      systemPrompt: systemPrompt?.trim() ?? '',
      includeExistingLore,
      aiGenerationSettings: settings,
      engineFileIds,
    },
    (status, detail) => onThinking(status, detail),
    onDelta,
  )

  return response_id ? { response_id } : {}
}
