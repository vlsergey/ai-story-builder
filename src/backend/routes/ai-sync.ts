import path from 'path'
import OpenAI, { toFile } from 'openai'
import { getCurrentDbPath } from '../db/state.js'
import { BUILTIN_ENGINES } from '../../shared/ai-engines.js'
import { createYandexClient, makeLoggingFetch } from '../lib/yandex-client.js'
import { createGrokClient } from '../lib/grok-client.js'
import { collapseLoreTree } from '../lib/lore-tree.js'
import { SettingsRepository } from '../settings/settings-repository.js'
import { LoreNodeRepository } from '../lore/lore-node-repository.js'
import { YandexEngineConfig } from '../../shared/ai-engine-config.js'

// Exported so tests can override without fake timers
export const POLL_CONFIG = {
  intervalMs: 5000,
  timeoutMs: 5 * 60 * 1000,
}

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiEngineSyncRecord {
  last_synced_at: string
  file_id?: string
  content_updated_at?: string
  /** Grok only: node's content was merged into the parent level-2 group file. */
  merged_into_parent?: boolean
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

  const frontmatter = [
    '---',
    `project: ${projectName}`,
    `path: ${nodePath}`,
    ...(parentName ? [`parent: ${parentName}`] : []),
    '---',
    '',
  ].join('\n')

  const segments = nodePath.split('/').filter(Boolean)
  const depth = segments.length - 1
  const headingLevel = Math.max(1, depth)
  const hashes = '#'.repeat(headingLevel)
  const headingText = depth >= 2 ? segments.slice(1).join(' / ') : row.name

  return frontmatter + `${hashes} ${headingText}\n\n` + (row.content ?? '')
}

function formatApiError(e: unknown): string {
  if (e != null && typeof e === 'object' && 'status' in e && 'message' in e) {
    const apiErr = e as { status: number; message: string; error?: unknown; headers?: unknown }

    let requestMethod: string | undefined
    let requestUrl: string | undefined
    const allHeaderEntries: [string, string][] = []

    if (apiErr.headers) {
      const h = apiErr.headers as Record<string, string> & { entries?: () => Iterable<[string, string]> }
      if (typeof h.entries === 'function') {
        for (const [k, v] of h.entries()) allHeaderEntries.push([k, v])
      } else {
        allHeaderEntries.push(...Object.entries(h) as [string, string][])
      }
      requestMethod = allHeaderEntries.find(([k]) => k.toLowerCase() === 'x-request-method')?.[1]
      requestUrl = allHeaderEntries.find(([k]) => k.toLowerCase() === 'x-request-url')?.[1]
    }

    const prefix = requestMethod && requestUrl ? `${requestMethod} ${requestUrl}\n` : ''
    const parts: string[] = [`${prefix}HTTP ${apiErr.status} ${apiErr.message}`]

    const hiddenHeaders = new Set(['authorization', 'api-key', 'x-api-key', 'x-request-url', 'x-request-method'])
    const safeHeaders = allHeaderEntries
      .filter(([k]) => !hiddenHeaders.has(k.toLowerCase()))
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n')
    if (safeHeaders) parts.push(`Response headers:\n${safeHeaders}`)

    if (apiErr.error != null) {
      parts.push(`Body: ${typeof apiErr.error === 'string' ? apiErr.error : JSON.stringify(apiErr.error, null, 2)}`)
    } else {
      parts.push('Body: (empty)')
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

function grokGroupNeedsReupload(
  l2GrokSync: AiEngineSyncRecord | undefined,
  groupRows: LoreNodeRow[],
): boolean {
  if (!l2GrokSync?.file_id) return true

  const lastSynced = l2GrokSync.last_synced_at

  for (const row of groupRows) {
    const syncMap = parseAiSyncInfoMap(row.ai_sync_info)
    const rowGrokSync = syncMap['grok']

    if (row.to_be_deleted === 1) {
      if (rowGrokSync?.merged_into_parent || rowGrokSync?.file_id) return true
      continue
    }

    if (row.word_count > 0) {
      if (!rowGrokSync) return true
      if (rowGrokSync.content_updated_at && rowGrokSync.content_updated_at > lastSynced) return true
    }
  }

  return false
}

async function deleteFileIfExists(client: OpenAI, fileId: string, context: string): Promise<void> {
  try {
    await client.files.delete(fileId)
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status
    if (status === 404) return
    if (status === 405) {
      try {
        const fileInfo = await client.files.retrieve(fileId)
        console.warn(`[AI Sync] DELETE ${fileId} returned 405 but file still exists: ${JSON.stringify(fileInfo)}`)
        throw new Error(`Delete file ${fileId} failed (HTTP 405, file still present):\n${context}\n${formatApiError(e)}`)
      } catch (retrieveErr: unknown) {
        if ((retrieveErr as { status?: number })?.status === 404) return
        throw new Error(`Delete file ${fileId} failed (HTTP 405, retrieve check also failed):\n${context}\n${formatApiError(e)}`)
      }
    }
    throw new Error(`Delete file ${fileId} failed:\n${context}\n${formatApiError(e)}`)
  }
}

async function waitForVectorStore(
  client: OpenAI,
  storeId: string,
): Promise<OpenAI.VectorStore> {
  const start = Date.now()
  while (Date.now() - start < POLL_CONFIG.timeoutMs) {
    const store = await client.vectorStores.retrieve(storeId)
    if (store.status === 'completed') return store
    if ((store.status as string) === 'failed' || store.status === 'expired') {
      throw new Error(`VectorStore ${storeId} reached status '${store.status}'`)
    }
    await new Promise(resolve => setTimeout(resolve, POLL_CONFIG.intervalMs))
  }
  throw new Error(`VectorStore creation timed out after ${POLL_CONFIG.timeoutMs / 1000}s (id=${storeId})`)
}

// Keep makeLoggingFetch import used by yandex-client
void makeLoggingFetch

// ─── Export ───────────────────────────────────────────────────────────────────

export async function syncLore(): Promise<{
  ok: boolean
  uploaded: number
  deleted: number
  unchanged: number
  search_index_id: string | null
}> {
  // Step 1 — load settings and nodes
  const currentEngine = SettingsRepository.getCurrentBackend()
  const config = SettingsRepository.getAllAiEnginesConfig()

  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  const repo = new LoreNodeRepository()
  const rows = repo.getAll()

  if (!currentEngine) {
    throw makeError('no AI engine configured', 400)
  }

  const engineDef = BUILTIN_ENGINES.find(e => e.id === currentEngine)
  if (!engineDef) {
    throw makeError(`Lore sync is not supported for engine '${currentEngine}'`, 400)
  }

  // ── Grok sync (collapsed tree, file attachment, no vector store) ──────────

  if (currentEngine === 'grok') {
    const apiKey = config.grok?.api_key?.trim()
    if (!apiKey) {
      throw makeError('Grok api_key is required', 400)
    }

    const maxFiles = engineDef.maxFilesPerRequest ?? 10
    const collapseResult = collapseLoreTree(rows, maxFiles)

    if ('error' in collapseResult) {
      throw makeError(collapseResult.error, 400)
    }

    const groups = collapseResult
    const client = createGrokClient(apiKey)
    const now = new Date().toISOString()

    const idToRow = new Map(rows.map(r => [r.id, r]))

    interface GrokGroupResult {
      group: typeof groups[number]
      action: 'upload' | 'delete' | 'unchanged'
      newFileId?: string
    }

    const results: GrokGroupResult[] = []

    for (const group of groups) {
      const l2Row = idToRow.get(group.level2NodeId)!
      const l2SyncMap = parseAiSyncInfoMap(l2Row.ai_sync_info)
      const l2GrokSync = l2SyncMap['grok']
      const groupRows = group.allNodeIds.map(id => idToRow.get(id)!).filter(Boolean)

      if (!group.hasContent) {
        results.push({ group, action: 'delete' })
        continue
      }

      if (grokGroupNeedsReupload(l2GrokSync, groupRows)) {
        results.push({ group, action: 'upload' })
      } else {
        results.push({ group, action: 'unchanged' })
      }
    }

    // Upload / delete
    for (const result of results) {
      const { group } = result
      const l2Row = idToRow.get(group.level2NodeId)!
      const l2SyncMap = parseAiSyncInfoMap(l2Row.ai_sync_info)
      const oldFileId = l2SyncMap['grok']?.file_id

      if (result.action === 'delete') {
        if (oldFileId && engineDef.capabilities.fileDeletion) {
          await deleteFileIfExists(client, oldFileId, `Grok group "${group.level2NodeName}"`)
        }
      } else if (result.action === 'upload') {
        if (oldFileId && engineDef.capabilities.fileDeletion) {
          await deleteFileIfExists(client, oldFileId, `Grok group "${group.level2NodeName}" (pre-upload cleanup)`)
        }
        try {
          const uploaded = await client.files.create({
            file: await toFile(
              Buffer.from(group.content, 'utf-8'),
              `lore-group-${group.level2NodeId}.md`,
              { type: 'text/plain' },
            ),
            purpose: 'assistants',
          })
          result.newFileId = uploaded.id
        } catch (e) {
          throw new Error(`Upload failed for Grok group "${group.level2NodeName}" (id=${group.level2NodeId}):\n${formatApiError(e)}`)
        }
      }
    }

    // Commit to DB
    for (const result of results) {
      const { group, action, newFileId } = result
      const groupRows = group.allNodeIds.map(id => idToRow.get(id)!).filter(Boolean)

      if (action === 'delete') {
        for (const row of groupRows) {
          const existing = parseAiSyncInfoMap(row.ai_sync_info)
          delete existing['grok']
          repo.updateAiSyncInfo(row.id, JSON.stringify(existing))
        }
      } else if (action === 'upload' && newFileId) {
        const l2Row = idToRow.get(group.level2NodeId)!
        const existing = parseAiSyncInfoMap(l2Row.ai_sync_info)
        existing['grok'] = { last_synced_at: now, file_id: newFileId, content_updated_at: now }
        repo.updateAiSyncInfo(group.level2NodeId, JSON.stringify(existing))

        for (const row of groupRows) {
          if (row.id === group.level2NodeId) continue
          const existing = parseAiSyncInfoMap(row.ai_sync_info)
          existing['grok'] = { last_synced_at: now, merged_into_parent: true, content_updated_at: now }
          repo.updateAiSyncInfo(row.id, JSON.stringify(existing))
        }
      }
    }

    repo.deleteMarkedForDeletion()

    const uploaded = results.filter(r => r.action === 'upload').length
    const deleted = results.filter(r => r.action === 'delete').length
    const unchanged = results.filter(r => r.action === 'unchanged').length

    return { ok: true, uploaded, deleted, unchanged, search_index_id: null }
  }

  // ── Yandex sync (individual file upload + VectorStore) ────────────────────

  if (currentEngine !== 'yandex') {
    throw makeError(`Lore sync is not supported for engine '${currentEngine}'`, 400)
  }
  const yandexEngineConfig = config.yandex as YandexEngineConfig

  const apiKey = yandexEngineConfig?.api_key?.trim()
  const folderId = yandexEngineConfig?.folder_id?.trim()
  if (!apiKey || !folderId) {
    throw makeError('Yandex api_key and folder_id are required', 400)
  }

  const projectName = path.basename(dbPath).replace(/\.[^.]+$/, '')
  const client = createYandexClient(apiKey, folderId)

  const idToRow = new Map(rows.map(r => [r.id, r]))
  const pathMap = buildPathMap(rows)

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

  const newFileIds = new Map<number, string>()
  for (const node of toUpload) {
    const row = idToRow.get(node.id)!

    if (node.yandexSync?.file_id) {
      await deleteFileIfExists(client, node.yandexSync.file_id, `Yandex node "${node.name}" (id=${node.id}, pre-upload cleanup)`)
    }

    try {
      const fileContent = buildFileContent(row, projectName, pathMap, idToRow)
      const uploaded = await client.files.create({
        file: await toFile(Buffer.from(fileContent, 'utf-8'), `lore-${node.id}.md`, { type: 'text/plain' }),
        purpose: 'assistants',
      })
      newFileIds.set(node.id, uploaded.id)
    } catch (e) {
      throw new Error(`Upload failed for node "${node.name}" (id=${node.id}):\n${formatApiError(e)}`)
    }
  }

  for (const node of toDelete) {
    if (node.yandexSync?.file_id) {
      await deleteFileIfExists(client, node.yandexSync.file_id, `Yandex node "${node.name}" (id=${node.id})`)
    }
  }

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

  const oldSearchIndexId = yandexEngineConfig?.search_index_id
  if (oldSearchIndexId) {
    try {
      await client.vectorStores.delete(oldSearchIndexId)
    } catch (e: unknown) {
      if ((e as { status?: number })?.status !== 404) {
        throw new Error(`Delete VectorStore ${oldSearchIndexId} failed:\n${formatApiError(e)}`)
      }
    }
  }

  let newSearchIndexId: string | undefined
  if (allFileIds.length > 0) {
    const store = await client.vectorStores.create({
      name: `story-lore-${Date.now()}`,
      file_ids: allFileIds,
    })
    const completed = store.status === 'completed'
      ? store
      : await waitForVectorStore(client, store.id)
    newSearchIndexId = completed.id
  }

  const now = new Date().toISOString()

  for (const [nodeId, fileId] of newFileIds.entries()) {
    const nodeRow = rows.find(r => r.id === nodeId)
    const existing = parseAiSyncInfoMap(nodeRow?.ai_sync_info ?? null)
    existing['yandex'] = { last_synced_at: now, file_id: fileId, content_updated_at: now }
    repo.updateAiSyncInfo(nodeId, JSON.stringify(existing))
  }

  for (const node of toDelete) {
    const nodeRow = rows.find(r => r.id === node.id)
    const existing = parseAiSyncInfoMap(nodeRow?.ai_sync_info ?? null)
    if (node.to_be_deleted === 1) {
      delete existing['yandex']
    } else {
      existing['yandex'] = { last_synced_at: now }
    }
    repo.updateAiSyncInfo(node.id, JSON.stringify(existing))
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

  SettingsRepository.saveAllAiEnginesConfig(updatedConfig)

  repo.deleteMarkedForDeletion()

  return {
    ok: true,
    uploaded: toUpload.length,
    deleted: toDelete.length,
    unchanged: unchanged.length,
    search_index_id: newSearchIndexId ?? null,
  }
}
