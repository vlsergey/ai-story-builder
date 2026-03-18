import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import type { AiSettings } from '../../shared/ai-settings.js'
import type { AiConfigStore } from '../lib/ai-engine-adapter.js'
import { getEngineAdapter } from '../lib/ai-engine-adapter.js'

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
    const db = new (Database)(dbPath, { readonly: true })
    const engineRow = db.prepare("SELECT value FROM settings WHERE key = 'current_backend'").get() as { value: string } | undefined
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as { value: string } | undefined

    engine = engineRow?.value
    if (!engine) { db.close(); throw makeError('no AI engine configured', 400) }
    if (configRow) {
      try { config = JSON.parse(configRow.value) as AiConfigStore } catch { /* ignore */ }
    }

    if (includeExistingLore && engine) {
      const nodes = db.prepare(
        'SELECT ai_sync_info FROM lore_nodes WHERE ai_sync_info IS NOT NULL AND to_be_deleted = 0'
      ).all() as { ai_sync_info: string }[]
      for (const node of nodes) {
        try {
          const info = JSON.parse(node.ai_sync_info) as Record<string, { file_id?: string }>
          const fileId = info[engine]?.file_id
          if (fileId) engineFileIds.push(fileId)
        } catch { /* ignore */ }
      }
    }

    db.close()
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
