import express, { Request, Response, Router } from 'express'
import { getCurrentDbPath } from '../db/state.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

const router: Router = express.Router()

// Exported so tests can override without fake timers
export const POLL_CONFIG = {
  intervalMs: 5000,
  timeoutMs: 5 * 60 * 1000,
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiEngineSyncRecord {
  last_synced_at: string
  file_id?: string
  content_updated_at?: string
}

interface YandexConfig {
  api_key?: string
  folder_id?: string
  models?: string
  search_index_id?: string
}

interface AiConfigStore {
  yandex?: YandexConfig
  [key: string]: unknown
}

interface LoreNodeRow {
  id: number
  name: string
  content: string | null
  word_count: number
  to_be_deleted: number
  ai_sync_info: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDb(dbPath: string, readonly = false) {
  if (!Database) throw new Error('SQLite lib missing')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return new (Database as typeof import('better-sqlite3'))(dbPath, readonly ? { readonly: true } : undefined)
}

function yandexHeaders(apiKey: string, folderId: string): Record<string, string> {
  return {
    Authorization: `Api-Key ${apiKey}`,
    'x-folder-id': folderId,
  }
}

async function uploadFile(apiKey: string, folderId: string, name: string, text: string): Promise<string> {
  const url = 'https://llm.api.cloud.yandex.net/files/v1/files'
  const formData = new FormData()
  const blob = new Blob([text], { type: 'text/plain' })
  formData.append('content', blob, `${name}.txt`)
  formData.append('mimeType', 'text/plain')
  formData.append('name', `${name}.txt`)
  formData.append('folderId', folderId)

  const r = await fetch(url, {
    method: 'POST',
    headers: yandexHeaders(apiKey, folderId),
    body: formData,
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`POST ${url} → HTTP ${r.status} (folder_id=${folderId})\n${body.trim()}`)
  }
  const data = await r.json() as { id: string }
  return data.id
}

async function deleteFile(apiKey: string, folderId: string, fileId: string): Promise<void> {
  const url = `https://llm.api.cloud.yandex.net/files/v1/files/${fileId}`
  const r = await fetch(url, {
    method: 'DELETE',
    headers: yandexHeaders(apiKey, folderId),
  })
  if (!r.ok && r.status !== 404) {
    const body = await r.text()
    throw new Error(`DELETE ${url} → HTTP ${r.status}\n${body.trim()}`)
  }
}

async function deleteSearchIndex(apiKey: string, folderId: string, indexId: string): Promise<void> {
  const url = `https://llm.api.cloud.yandex.net/searchindex/v1/searchindex/${indexId}`
  const r = await fetch(url, {
    method: 'DELETE',
    headers: yandexHeaders(apiKey, folderId),
  })
  if (!r.ok && r.status !== 404) {
    const body = await r.text()
    throw new Error(`DELETE ${url} → HTTP ${r.status}\n${body.trim()}`)
  }
}

async function pollOperation(
  apiKey: string,
  folderId: string,
  operationId: string,
): Promise<Record<string, unknown>> {
  const url = `https://llm.api.cloud.yandex.net/operations/${operationId}`
  const start = Date.now()
  while (Date.now() - start < POLL_CONFIG.timeoutMs) {
    const r = await fetch(url, {
      headers: yandexHeaders(apiKey, folderId),
    })
    if (!r.ok) {
      const body = await r.text()
      throw new Error(`GET ${url} → HTTP ${r.status}\n${body.trim()}`)
    }
    const data = await r.json() as Record<string, unknown>
    if (data['done']) {
      if (data['error']) {
        throw new Error(`Operation ${operationId} failed: ${JSON.stringify(data['error'])}`)
      }
      return data
    }
    await new Promise(resolve => setTimeout(resolve, POLL_CONFIG.intervalMs))
  }
  throw new Error(`SearchIndex creation timed out after ${POLL_CONFIG.timeoutMs / 1000}s (operation ${operationId})`)
}

async function createAndWaitForSearchIndex(
  apiKey: string,
  folderId: string,
  fileIds: string[]
): Promise<string> {
  const url = 'https://llm.api.cloud.yandex.net/searchindex/v1/searchindex'
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...yandexHeaders(apiKey, folderId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      folderId,
      name: `story-lore-${Date.now()}`,
      fileIds,
      textSearchIndex: {},
    }),
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`POST ${url} → HTTP ${r.status} (folder_id=${folderId})\n${body.trim()}`)
  }
  const operation = await r.json() as { id: string; done?: boolean; response?: { id: string } }

  // If the operation completed synchronously
  if (operation.done && operation.response?.id) {
    return operation.response.id
  }

  const completed = await pollOperation(apiKey, folderId, operation.id)
  const response = completed['response'] as { id: string } | undefined
  if (!response?.id) {
    throw new Error('SearchIndex creation completed but no index ID returned')
  }
  return response.id
}

function parseYandexSync(aiSyncInfoJson: string | null): AiEngineSyncRecord | undefined {
  if (!aiSyncInfoJson) return undefined
  try {
    const parsed = JSON.parse(aiSyncInfoJson) as Record<string, AiEngineSyncRecord>
    return parsed['yandex']
  } catch {
    return undefined
  }
}

function parseAiSyncInfoMap(aiSyncInfoJson: string | null): Record<string, AiEngineSyncRecord> {
  if (!aiSyncInfoJson) return {}
  try {
    return JSON.parse(aiSyncInfoJson) as Record<string, AiEngineSyncRecord>
  } catch {
    return {}
  }
}

// ─── POST /sync-lore ─────────────────────────────────────────────────────────

router.post('/sync-lore', async (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  try {
    // Step 1 — load current engine, credentials, and all lore nodes
    const db = getDb(dbPath, true)
    const engineRow = db
      .prepare("SELECT value FROM settings WHERE key = 'current_backend'")
      .get() as { value: string } | undefined
    const configRow = db
      .prepare("SELECT value FROM settings WHERE key = 'ai_config'")
      .get() as { value: string } | undefined

    // Step 2 — load all lore nodes
    const rows = db
      .prepare('SELECT id, name, content, word_count, to_be_deleted, ai_sync_info FROM lore_nodes')
      .all() as LoreNodeRow[]
    db.close()

    const currentEngine = engineRow?.value
    if (!currentEngine) {
      return res.status(400).json({ error: 'no AI engine configured' })
    }

    let config: AiConfigStore = {}
    if (configRow) {
      try { config = JSON.parse(configRow.value) as AiConfigStore } catch { /* ignore */ }
    }

    // Dispatch to the engine-specific adapter
    if (currentEngine !== 'yandex') {
      return res.status(400).json({ error: `Lore sync is not supported for engine '${currentEngine}'` })
    }

    const apiKey = config.yandex?.api_key?.trim()
    const folderId = config.yandex?.folder_id?.trim()
    if (!apiKey || !folderId) {
      return res.status(400).json({ error: 'Yandex api_key and folder_id are required' })
    }

    // Step 3 — categorise
    interface NodeInfo {
      id: number
      name: string
      content: string
      word_count: number
      to_be_deleted: number
      yandexSync: AiEngineSyncRecord | undefined
    }

    const toUpload: NodeInfo[] = []
    const toDelete: NodeInfo[] = []
    const unchanged: NodeInfo[] = []

    for (const row of rows) {
      const yandexSync = parseYandexSync(row.ai_sync_info)
      const info: NodeInfo = {
        id: row.id,
        name: row.name,
        content: row.content ?? '',
        word_count: row.word_count,
        to_be_deleted: row.to_be_deleted,
        yandexSync,
      }

      const needsDelete = !!(yandexSync?.file_id && (row.to_be_deleted === 1 || row.word_count === 0))
      const needsUpload = row.to_be_deleted === 0 && row.word_count > 0 && (
        !yandexSync ||
        !!(yandexSync.content_updated_at && yandexSync.content_updated_at > yandexSync.last_synced_at)
      )

      if (needsDelete) {
        toDelete.push(info)
      } else if (needsUpload) {
        toUpload.push(info)
      } else if (row.to_be_deleted === 0 && row.word_count > 0) {
        unchanged.push(info)
      }
    }

    // Step 4 — upload files
    const newFileIds = new Map<number, string>()
    for (const node of toUpload) {
      try {
        const fileId = await uploadFile(apiKey, folderId, node.name, node.content)
        newFileIds.set(node.id, fileId)
      } catch (e) {
        throw new Error(`Upload failed for node "${node.name}" (id=${node.id}):\n${String(e)}`)
      }
    }

    // Step 5 — delete remote files
    for (const node of toDelete) {
      if (node.yandexSync?.file_id) {
        await deleteFile(apiKey, folderId, node.yandexSync.file_id)
      }
    }

    // Step 6 — collect all valid file IDs for new index
    const deleteNodeIds = new Set(toDelete.map(n => n.id))
    const allFileIds: string[] = []

    for (const row of rows) {
      if (deleteNodeIds.has(row.id)) continue

      const newFileId = newFileIds.get(row.id)
      if (newFileId) {
        allFileIds.push(newFileId)
        continue
      }

      const yandexSync = parseYandexSync(row.ai_sync_info)
      if (yandexSync?.file_id) {
        allFileIds.push(yandexSync.file_id)
      }
    }

    // Step 7 — rebuild SearchIndex
    const oldSearchIndexId = config.yandex?.search_index_id

    if (oldSearchIndexId) {
      await deleteSearchIndex(apiKey, folderId, oldSearchIndexId)
    }

    let newSearchIndexId: string | undefined
    if (allFileIds.length > 0) {
      newSearchIndexId = await createAndWaitForSearchIndex(apiKey, folderId, allFileIds)
    }

    // Step 8 — commit to DB (single transaction)
    const now = new Date().toISOString()
    const db2 = getDb(dbPath)

    db2.transaction(() => {
      const updateStmt = db2.prepare('UPDATE lore_nodes SET ai_sync_info = ? WHERE id = ?')

      // Update uploaded nodes
      for (const [nodeId, fileId] of newFileIds.entries()) {
        const nodeRow = rows.find(r => r.id === nodeId)
        const existing = parseAiSyncInfoMap(nodeRow?.ai_sync_info ?? null)
        existing['yandex'] = { last_synced_at: now, file_id: fileId, content_updated_at: now }
        updateStmt.run(JSON.stringify(existing), nodeId)
      }

      // Update deleted nodes
      for (const node of toDelete) {
        const nodeRow = rows.find(r => r.id === node.id)
        const existing = parseAiSyncInfoMap(nodeRow?.ai_sync_info ?? null)

        if (node.to_be_deleted === 1) {
          // Remove yandex entry entirely
          delete existing['yandex']
        } else {
          // word_count === 0 — keep record but without file_id
          existing['yandex'] = { last_synced_at: now }
        }
        updateStmt.run(JSON.stringify(existing), node.id)
      }

      // Update search_index_id in settings
      const updatedConfig = { ...config }
      if (!updatedConfig.yandex) updatedConfig.yandex = {}
      if (newSearchIndexId) {
        updatedConfig.yandex = { ...updatedConfig.yandex, search_index_id: newSearchIndexId }
      } else {
        const { search_index_id: _removed, ...rest } = updatedConfig.yandex
        void _removed
        updatedConfig.yandex = rest
      }

      db2.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_config', ?)")
        .run(JSON.stringify(updatedConfig))
    })()

    db2.close()

    // Step 9 — return
    res.json({
      ok: true,
      uploaded: toUpload.length,
      deleted: toDelete.length,
      unchanged: unchanged.length,
      search_index_id: newSearchIndexId ?? null,
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

export default router
