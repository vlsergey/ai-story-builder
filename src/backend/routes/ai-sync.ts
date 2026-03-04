import path from 'path'
import express, { Request, Response, Router } from 'express'
import OpenAI, { toFile } from 'openai'
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
  parent_id: number | null
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

function createYandexClient(apiKey: string, folderId: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: 'https://ai.api.cloud.yandex.net/v1',
    project: folderId,
  })
}

function buildPathMap(rows: LoreNodeRow[]): Map<number, string> {
  const idToRow = new Map(rows.map(r => [r.id, r]))
  const paths = new Map<number, string>()

  function getPath(id: number): string {
    if (paths.has(id)) return paths.get(id)!
    const row = idToRow.get(id)!
    if (!row.parent_id) {
      const p = `/${row.name}`
      paths.set(id, p)
      return p
    }
    const p = `${getPath(row.parent_id)}/${row.name}`
    paths.set(id, p)
    return p
  }

  for (const row of rows) getPath(row.id)
  return paths
}

function buildFileContent(
  row: LoreNodeRow,
  projectName: string,
  pathMap: Map<number, string>,
  idToRow: Map<number, LoreNodeRow>,
): string {
  const nodePath = pathMap.get(row.id) ?? `/${row.name}`
  const parentName = row.parent_id ? (idToRow.get(row.parent_id)?.name ?? '') : ''

  const lines = [
    '---',
    `project: ${projectName}`,
    `path: ${nodePath}`,
    ...(parentName ? [`parent: ${parentName}`] : []),
    '---',
    '',
  ]
  return lines.join('\n') + (row.content ?? '')
}

function formatApiError(e: unknown): string {
  if (e != null && typeof e === 'object' && 'status' in e && 'message' in e) {
    const apiErr = e as { status: number; message: string; error?: unknown; headers?: unknown }
    const parts: string[] = [`HTTP ${apiErr.status} ${apiErr.message}`]
    if (apiErr.headers) {
      // headers can be a Fetch API Headers object or a plain object
      const entries: [string, string][] = []
      const h = apiErr.headers as Record<string, string> & { entries?: () => Iterable<[string, string]> }
      if (typeof h.entries === 'function') {
        for (const [k, v] of h.entries()) entries.push([k, v])
      } else {
        entries.push(...Object.entries(h) as [string, string][])
      }
      const safeHeaders = entries
        .filter(([k]) => !['authorization', 'api-key', 'x-api-key'].includes(k.toLowerCase()))
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
      if (safeHeaders) parts.push(`Response headers:\n${safeHeaders}`)
    }
    if (apiErr.error != null) {
      parts.push(`Body: ${typeof apiErr.error === 'string' ? apiErr.error : JSON.stringify(apiErr.error, null, 2)}`)
    }
    return parts.join('\n')
  }
  return String(e)
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

async function waitForVectorStore(
  client: OpenAI,
  storeId: string,
): Promise<OpenAI.Beta.VectorStore> {
  const start = Date.now()
  while (Date.now() - start < POLL_CONFIG.timeoutMs) {
    const store = await client.beta.vectorStores.retrieve(storeId)
    if (store.status === 'completed') return store
    if (store.status === 'failed' || store.status === 'expired') {
      throw new Error(`VectorStore ${storeId} reached status '${store.status}'`)
    }
    await new Promise(resolve => setTimeout(resolve, POLL_CONFIG.intervalMs))
  }
  throw new Error(`VectorStore creation timed out after ${POLL_CONFIG.timeoutMs / 1000}s (id=${storeId})`)
}

// ─── POST /sync-lore ─────────────────────────────────────────────────────────

router.post('/sync-lore', async (_req: Request, res: Response) => {
  const dbPath = getCurrentDbPath()
  if (!dbPath) return res.status(400).json({ error: 'no project open' })
  if (!Database) return res.status(500).json({ error: 'SQLite lib missing' })

  try {
    // Step 1 — load settings and nodes
    const db = getDb(dbPath, true)
    const engineRow = db
      .prepare("SELECT value FROM settings WHERE key = 'current_backend'")
      .get() as { value: string } | undefined
    const configRow = db
      .prepare("SELECT value FROM settings WHERE key = 'ai_config'")
      .get() as { value: string } | undefined

    const rows = db
      .prepare('SELECT id, parent_id, name, content, word_count, to_be_deleted, ai_sync_info FROM lore_nodes')
      .all() as LoreNodeRow[]
    db.close()

    const currentEngine = engineRow?.value
    if (!currentEngine) {
      return res.status(400).json({ error: 'no AI engine configured' })
    }
    if (currentEngine !== 'yandex') {
      return res.status(400).json({ error: `Lore sync is not supported for engine '${currentEngine}'` })
    }

    let config: AiConfigStore = {}
    if (configRow) {
      try { config = JSON.parse(configRow.value) as AiConfigStore } catch { /* ignore */ }
    }

    const apiKey = config.yandex?.api_key?.trim()
    const folderId = config.yandex?.folder_id?.trim()
    if (!apiKey || !folderId) {
      return res.status(400).json({ error: 'Yandex api_key and folder_id are required' })
    }

    const projectName = path.basename(dbPath).replace(/\.[^.]+$/, '')
    const client = createYandexClient(apiKey, folderId)

    // Build path and parent helpers
    const idToRow = new Map(rows.map(r => [r.id, r]))
    const pathMap = buildPathMap(rows)

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

    // Step 4 — upload files (Markdown with YAML frontmatter tags)
    const newFileIds = new Map<number, string>()
    for (const node of toUpload) {
      const row = idToRow.get(node.id)!
      try {
        const fileContent = buildFileContent(row, projectName, pathMap, idToRow)
        const uploaded = await client.files.create({
          // Use ASCII-safe filename (node name is in the YAML frontmatter content)
          file: await toFile(Buffer.from(fileContent, 'utf-8'), `lore-${node.id}.md`, { type: 'text/plain' }),
          purpose: 'assistants',
        })
        newFileIds.set(node.id, uploaded.id)
      } catch (e) {
        throw new Error(`Upload failed for node "${node.name}" (id=${node.id}):\n${formatApiError(e)}`)
      }
    }

    // Step 5 — delete remote files
    for (const node of toDelete) {
      if (node.yandexSync?.file_id) {
        try {
          await client.files.del(node.yandexSync.file_id)
        } catch (e: unknown) {
          if ((e as { status?: number })?.status !== 404) {
            throw new Error(`Delete file ${node.yandexSync.file_id} failed:\n${formatApiError(e)}`)
          }
        }
      }
    }

    // Step 6 — collect all valid file IDs for new vector store
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

    // Step 7 — rebuild VectorStore (delete old, create new)
    const oldSearchIndexId = config.yandex?.search_index_id
    if (oldSearchIndexId) {
      try {
        await client.beta.vectorStores.del(oldSearchIndexId)
      } catch (e: unknown) {
        if ((e as { status?: number })?.status !== 404) {
          throw new Error(`Delete VectorStore ${oldSearchIndexId} failed:\n${formatApiError(e)}`)
        }
      }
    }

    let newSearchIndexId: string | undefined
    if (allFileIds.length > 0) {
      const store = await client.beta.vectorStores.create({
        name: `story-lore-${Date.now()}`,
        file_ids: allFileIds,
      })
      const completed = store.status === 'completed'
        ? store
        : await waitForVectorStore(client, store.id)
      newSearchIndexId = completed.id
    }

    // Step 8 — commit to DB (single transaction)
    const now = new Date().toISOString()
    const db2 = getDb(dbPath)

    db2.transaction(() => {
      const updateStmt = db2.prepare('UPDATE lore_nodes SET ai_sync_info = ? WHERE id = ?')

      for (const [nodeId, fileId] of newFileIds.entries()) {
        const nodeRow = rows.find(r => r.id === nodeId)
        const existing = parseAiSyncInfoMap(nodeRow?.ai_sync_info ?? null)
        existing['yandex'] = { last_synced_at: now, file_id: fileId, content_updated_at: now }
        updateStmt.run(JSON.stringify(existing), nodeId)
      }

      for (const node of toDelete) {
        const nodeRow = rows.find(r => r.id === node.id)
        const existing = parseAiSyncInfoMap(nodeRow?.ai_sync_info ?? null)
        if (node.to_be_deleted === 1) {
          delete existing['yandex']
        } else {
          existing['yandex'] = { last_synced_at: now }
        }
        updateStmt.run(JSON.stringify(existing), node.id)
      }

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
