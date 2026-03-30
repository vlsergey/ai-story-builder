import type { AiGenerationSettings } from '../../shared/ai-generation-settings.js'
import type { JsonSchemaSpec } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'
import OpenAI from 'openai'

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

const LORE_RESPONSE_SCHEMA: JsonSchemaSpec = {
  name: 'lore_node',
  description: 'A lore item with a short name and content in markdown format',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short name or title for the lore item (1–10 words) in plain text' },
      content: { type: 'string', description: 'Full content of the lore item in markdown format' },
    },
    required: ['name', 'content'],
    additionalProperties: false,
  },
}

export interface GenerateLoreParams {
  instructions?: string
  mode?: 'generate' | 'improve'
  baseContent?: string
  aiGenerationSettings?: AiGenerationSettings
  includeExistingLore?: boolean
}

export async function generateLore(
  nodeId: number,
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
): Promise<string> {
  const loreRepo = new LoreNodeRepository()
  const node = loreRepo.getById(nodeId)
  if (!node) throw makeError('node not found', 404)

  const {
    ai_user_prompt: aiUserPrompt,
    ai_system_prompt: aiSystemPrompt,
    ai_settings: nodeAiSettings,
  } = node

  const responseSchema = LORE_RESPONSE_SCHEMA
  if (!aiUserPrompt?.trim()) throw makeError('user prompt is required', 400)

  // let engine: string | undefined
  // let textLanguage: string | null
  // const engineFileIds: string[] = []

  // try {
    // if (includeExistingLore && engine) {
    //   const nodes = loreRepo.getAllWithAiSyncInfo()
    //   for (const node of nodes) {
    //     try {
    //       const info = JSON.parse(node.ai_sync_info!) as Record<string, { file_id?: string }>
    //       const fileId = info[engine]?.file_id
    //       if (fileId) engineFileIds.push(fileId)
    //     } catch { /* ignore */ }
    //   }
    // }
  // } catch (e: any) {
  //   if (e.status) throw e
  //   throw makeError('failed to read project settings: ' + String(e), 500)
  // }

  const engineId = SettingsRepository.getCurrentBackend()
  if (!engineId) throw makeError('no AI engine configured', 400)

  const adapter = getEngineAdapter(engineId)
  if (!adapter) throw makeError(`Engine ${engineId} not found`, 400)

  const nodeEngineAiSettings = (JSON.parse(nodeAiSettings || '{}') as Record<string, AiGenerationSettings>)[engineId] || {}
  const aiGenerationSettings = {
    ...SettingsRepository.getCurrentEngineDefaultAiGenerationSettings(),
    ...nodeEngineAiSettings
  }

  return await adapter.generateResponse(
    {
      userPrompt: aiUserPrompt!.trim(),
      systemPrompt: aiSystemPrompt?.trim() ?? null,
      // TODO: fix and implement it it
      includeExistingLore: false,
      aiGenerationSettings,
      // TODO: fix and implement it it
      engineFileIds: [],
      responseSchema,
    },
    onEvent
  )
}
