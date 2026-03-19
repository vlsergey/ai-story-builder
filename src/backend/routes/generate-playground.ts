import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiSettings } from '../../shared/ai-settings.js'
import type { AiConfigStore } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

export async function generatePlayground(
  params: { systemPrompt?: string; prompt?: string; settings?: AiSettings },
  onThinking: (status: string, detail?: string) => void,
  onPartialJson: (data: Record<string, unknown>) => void,
): Promise<{ response_id?: string }> {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)

  const { systemPrompt, prompt, settings = {} } = params
  const { model: requestedModel, webSearch, includeExistingLore, maxTokens, maxCompletionTokens } = settings

  if (!prompt?.trim()) throw makeError('prompt is required', 400)

  let engine: string | undefined
  let config: AiConfigStore = {}
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.get('current_backend') || undefined
    if (!engine) throw makeError('no AI engine configured', 400)
    config = SettingsRepository.getJson<AiConfigStore>('ai_config') ?? {}

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

  const engineDef = BUILTIN_ENGINES.find(e => e.id === engine)
  if (!engineDef) throw makeError(`Playground is not supported for engine '${engine}'`, 400)

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
      model: requestedModel?.trim() ?? '',
      includeExistingLore: includeExistingLore ?? false,
      webSearch: webSearch ?? 'none',
      engineFileIds,
      engineDef,
      config,
      maxTokens: maxTokens ?? undefined,
      maxCompletionTokens: maxCompletionTokens ?? undefined,
    },
    (status, detail) => onThinking(status, detail),
    onDelta,
  )

  return response_id ? { response_id } : {}
}
