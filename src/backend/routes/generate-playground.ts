import type { AiGenerationSettings } from '../../shared/ai-generation-settings.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'
import OpenAI from 'openai';

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

export async function generatePlayground(
  params: { instructions?: string; settings?: AiGenerationSettings; includeExistingLore?: boolean },
  onError: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<{ response_id?: string }> {
  const { instructions, settings = {}, includeExistingLore = false } = params

  if (!instructions?.trim()) throw makeError('instructions is required', 400)

  let engine: string | undefined
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.getCurrentBackend() || undefined
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

  await adapter.generateResponse(
    {
      userPrompt: instructions.trim(),
      systemPrompt: null,
      includeExistingLore,
      aiGenerationSettings: settings,
      engineFileIds,
    },
    onError,
  )

  return {}
}
