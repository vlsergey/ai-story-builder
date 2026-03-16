// Typed IPC client that replaces fetch('/api/...') calls.
// Uses window.electronAPI.invoke() to call IPC handlers registered in main.js.

class IpcError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await window.electronAPI!.invoke(channel, ...args) as any
  if (result && typeof result === 'object' && result.__ipcError) {
    throw new IpcError(result.message as string, result.status as number)
  }
  return result as T
}

export const ipcClient = {
  lore: {
    tree: () => invoke<any[]>('lore:tree'),
    get: (id: number) => invoke<any>('lore:get', id),
    create: (data: { parent_id?: number | null; name: string }) => invoke<{ id: number }>('lore:create', data),
    patch: (id: number, data: Record<string, unknown>) => invoke<{ ok: boolean; word_count?: number | null; char_count?: number | null; byte_count?: number | null; ai_sync_info?: Record<string, unknown> | null }>('lore:patch', id, data),
    delete: (id: number) => invoke<{ ok: boolean }>('lore:delete', id),
    import: (data: { name: string; content: string; parentId: number }) => invoke<{ id: number }>('lore:import', data),
    move: (id: number, data: { parent_id?: number | null }) => invoke<{ ok: boolean }>('lore:move', id, data),
    duplicate: (id: number) => invoke<{ id: number }>('lore:duplicate', id),
    sortChildren: (id: number) => invoke<{ ok: boolean; sorted: number }>('lore:sort-children', id),
    reorderChildren: (child_ids: number[]) => invoke<{ ok: boolean }>('lore:reorder-children', { child_ids }),
    restore: (id: number) => invoke<{ ok: boolean }>('lore:restore', id),
  },
  planGraph: {
    nodes: () => invoke<any[]>('plan:graph:nodes'),
    getNode: (id: number) => invoke<any>('plan:graph:node:get', id),
    createNode: (data: Record<string, unknown>) => invoke<{ id: number }>('plan:graph:node:create', data),
    patchNode: (id: number, data: Record<string, unknown>) => invoke<{ ok: boolean; word_count?: number | null; char_count?: number | null; byte_count?: number | null }>('plan:graph:node:patch', id, data),
    deleteNode: (id: number) => invoke<{ ok: boolean }>('plan:graph:node:delete', id),
    get: () => invoke<{ nodes: any[]; edges: any[] }>('plan:graph'),
    createEdge: (data: Record<string, unknown>) => invoke<{ id: number }>('plan:graph:edge:create', data),
    patchEdge: (id: number, data: Record<string, unknown>) => invoke<{ ok: boolean }>('plan:graph:edge:patch', id, data),
    deleteEdge: (id: number) => invoke<{ ok: boolean }>('plan:graph:edge:delete', id),
  },
  project: {
    status: () => invoke<{ isOpen: boolean; path: string | null }>('project:status'),
    open: (dbPath: string) => invoke<{ path: string; layout: unknown; projectTitle: string | null }>('project:open', dbPath),
    close: () => invoke<{ ok: boolean }>('project:close'),
    recent: () => invoke<string[]>('project:recent'),
    deleteRecent: (p: string) => invoke<{ ok: boolean }>('project:recent:delete', p),
    files: () => invoke<{ dir: string; files: string[] }>('project:files'),
    openFolder: () => invoke<{ ok: boolean }>('project:open-folder'),
    create: (data: { name?: string; text_language?: string }) => invoke<{ path: string; layout: unknown; projectTitle: string | null }>('project:create', data),
  },
  settings: {
    getLayout: () => invoke<unknown>('settings:layout:get'),
    saveLayout: (layout: unknown) => invoke<{ ok: boolean }>('settings:layout:save', layout),
    setVerboseAiLogging: (value: unknown) => invoke<{ ok: boolean }>('settings:verbose-ai-logging', value),
    get: (key: string) => invoke<{ value: string | null }>('settings:get', key),
    set: (key: string, value: unknown) => invoke<{ ok: boolean }>('settings:set', key, value),
  },
  generation: {
    updatePart: (id: number, data: { content: string }) => invoke<{ ok: boolean }>('generated-part:update', id, data),
  },
  ai: {
    getConfig: () => invoke<Record<string, unknown>>('ai:config:get'),
    saveConfig: (data: { engine: string; fields: Record<string, unknown> }) => invoke<{ ok: boolean }>('ai:config:save', data),
    setCurrentEngine: (data: { engine: string | null }) => invoke<{ ok: boolean }>('ai:current-engine', data),
    getModels: (engine: string) => invoke<{ models: string[] }>('ai:models:get', engine),
    refreshModels: (engine: string) => invoke<{ models: string[] }>('ai:models:refresh', engine),
    test: (engine: string, creds: Record<string, string>) => invoke<{ ok: boolean; detail?: string; error?: string }>('ai:test', engine, creds),
    billing: () => invoke<{ configured: boolean; totals?: Record<string, unknown>; error?: string }>('ai:billing'),
    syncLore: () => invoke<{ ok: boolean; uploaded: number; deleted: number; unchanged: number; search_index_id: string | null }>('ai:sync-lore'),
    generateSummary: (params: { node_id: number; content?: string }) => invoke<{ summary: string; response_id?: string }>('ai:generate-summary', params),
  },
}
