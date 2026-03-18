import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { getLoreTree, getLoreNode, createLoreNode, patchLoreNode, deleteLoreNode, importLoreNode, moveLoreNode, duplicateLoreNode, sortLoreChildren, reorderLoreChildren, restoreLoreNode } from '../routes/lore.js'
import { getPlanNodes, getPlanNode, createPlanNode, patchPlanNode, deletePlanNode } from '../plan/plan-routes.js'
import { getPlanGraph, createGraphEdge, patchGraphEdge, deleteGraphEdge } from '../plan/plan-routes.js'
import { getProjectStatus, closeProject, openProject, getRecentProjects, deleteRecentProject, listProjectFiles, openProjectFolder, createProject, applyRuntimeSettings } from '../routes/projects.js'
import { getLayout, saveLayout, setVerboseAiLogging, getSetting, setSetting } from '../routes/settings.js'
import { getAiConfig, saveAiConfig, setCurrentEngine, getEngineModels, refreshEngineModels, testEngineConnection } from '../routes/ai-config.js'
import { getAiBilling } from '../routes/ai-billing.js'
import { syncLore } from '../routes/ai-sync.js'
import { generateLore } from '../routes/generate-lore.js'
import { generatePlan } from '../routes/generate-plan.js'
import { generatePlayground } from '../routes/generate-playground.js'
import { generateAll } from '../routes/generate-all.js'
import { generateSummary } from '../routes/generate-summary.js'
import { generate, updateGeneratedPart } from '../routes/generation.js'
import { restoreLastOpenedProject } from '../db/state.js'

// Unify stdout/stderr to avoid log buffering issues
const nodeConsole = require('console')
// Create a new console instance where both streams go to stdout
const unifiedConsole = new nodeConsole.Console(process.stdout, process.stdout)
console.log = unifiedConsole.log.bind(unifiedConsole)
console.error = unifiedConsole.error.bind(unifiedConsole)
console.warn = unifiedConsole.warn.bind(unifiedConsole)
console.info = unifiedConsole.info.bind(unifiedConsole)

// Map of active stream AbortControllers
const activeStreams = new Map<string, AbortController>()

function wrap(fn: (...args: any[]) => any) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    try { return await fn(...args) }
    catch (e: any) { return { __ipcError: true, message: e.message, status: e.status ?? 500 } }
  }
}

// Stream dispatcher
const STREAM_ENDPOINTS: Record<string, (params: any, onThinking: any, onPartialJson: any) => Promise<any>> = {
  'generate-lore': (p, onThinking, onPartialJson) => generateLore(p, onThinking, onPartialJson),
  'generate-plan': (p, onThinking, onPartialJson) => generatePlan(p, onThinking, onPartialJson),
  'generate-playground': (p, onThinking, onPartialJson) => generatePlayground(p, onThinking, onPartialJson),
  'generate-all': (p, onThinking, onPartialJson) => generateAll(p, onThinking, onPartialJson),
}

function startStreamHandler(sender: WebContents, streamId: string, endpoint: string, params: unknown) {
  const ac = new AbortController()
  activeStreams.set(streamId, ac)

  const handler = STREAM_ENDPOINTS[endpoint]
  if (!handler) {
    sender.send('stream:event', { streamId, type: 'error', data: { message: `Unknown stream endpoint: ${endpoint}` } })
    activeStreams.delete(streamId)
    return
  }

  const onThinking = (status: string, detail?: string) => {
    if (ac.signal.aborted) return
    sender.send('stream:event', { streamId, type: 'thinking', data: detail ? { status, detail } : { status } })
  }

  const onPartialJson = (data: Record<string, unknown>) => {
    if (ac.signal.aborted) return
    sender.send('stream:event', { streamId, type: 'partial_json', data })
  }

  handler(params, onThinking, onPartialJson).then((result: any) => {
    if (!ac.signal.aborted) {
      sender.send('stream:event', { streamId, type: 'done', data: result })
    }
  }).catch((e: any) => {
    if (!ac.signal.aborted) {
      sender.send('stream:event', { streamId, type: 'error', data: { message: e.message, stack: e.stack } })
    }
  }).finally(() => {
    activeStreams.delete(streamId)
  })
}

export function registerIpcHandlers(): void {
  // Restore last opened project on startup
  const restoredPath = restoreLastOpenedProject()
  if (restoredPath) applyRuntimeSettings(restoredPath)

  // Lore
  ipcMain.handle('lore:tree', wrap(getLoreTree))
  ipcMain.handle('lore:get', wrap((id: number) => getLoreNode(id)))
  ipcMain.handle('lore:create', wrap((data: any) => createLoreNode(data)))
  ipcMain.handle('lore:patch', wrap((id: number, data: any) => patchLoreNode(id, data)))
  ipcMain.handle('lore:delete', wrap((id: number) => deleteLoreNode(id)))
  ipcMain.handle('lore:import', wrap((data: any) => importLoreNode(data)))
  ipcMain.handle('lore:move', wrap((id: number, data: any) => moveLoreNode(id, data)))
  ipcMain.handle('lore:duplicate', wrap((id: number) => duplicateLoreNode(id)))
  ipcMain.handle('lore:sort-children', wrap((id: number) => sortLoreChildren(id)))
  ipcMain.handle('lore:reorder-children', wrap((data: any) => reorderLoreChildren(data.child_ids)))
  ipcMain.handle('lore:restore', wrap((id: number) => restoreLoreNode(id)))


  // Plan graph
  ipcMain.handle('plan:graph', wrap(getPlanGraph))
  ipcMain.handle('plan:graph:nodes', wrap(getPlanNodes))
  ipcMain.handle('plan:graph:node:create', wrap((data: any) => createPlanNode(data)))
  ipcMain.handle('plan:graph:node:get', wrap((id: number) => getPlanNode(id)))
  ipcMain.handle('plan:graph:node:patch', wrap((id: number, data: any) => patchPlanNode(id, data)))
  ipcMain.handle('plan:graph:node:delete', wrap((id: number) => deletePlanNode(id)))
  ipcMain.handle('plan:graph:edge:create', wrap((data: any) => createGraphEdge(data)))
  ipcMain.handle('plan:graph:edge:patch', wrap((id: number, data: any) => patchGraphEdge(id, data)))
  ipcMain.handle('plan:graph:edge:delete', wrap((id: number) => deleteGraphEdge(id)))

  // Projects
  ipcMain.handle('project:status', wrap(getProjectStatus))
  ipcMain.handle('project:close', wrap(closeProject))
  ipcMain.handle('project:open', wrap((dbPath: string) => openProject(dbPath)))
  ipcMain.handle('project:recent', wrap(getRecentProjects))
  ipcMain.handle('project:recent:delete', wrap((p: string) => deleteRecentProject(p)))
  ipcMain.handle('project:files', wrap(listProjectFiles))
  ipcMain.handle('project:open-folder', wrap(openProjectFolder))
  ipcMain.handle('project:create', wrap((data: any) => createProject(data)))

  // Settings
  ipcMain.handle('settings:layout:get', wrap(getLayout))
  ipcMain.handle('settings:layout:save', wrap((layout: any) => saveLayout(layout)))
  ipcMain.handle('settings:verbose-ai-logging', wrap((value: any) => setVerboseAiLogging(value)))
  ipcMain.handle('settings:get', wrap((key: string) => getSetting(key)))
  ipcMain.handle('settings:set', wrap((key: string, value: any) => setSetting(key, value)))

  // AI Config
  ipcMain.handle('ai:config:get', wrap(getAiConfig))
  ipcMain.handle('ai:config:save', wrap((data: any) => saveAiConfig(data)))
  ipcMain.handle('ai:current-engine', wrap((data: any) => setCurrentEngine(data)))
  ipcMain.handle('ai:models:get', wrap((engine: string) => getEngineModels(engine)))
  ipcMain.handle('ai:models:refresh', wrap((engine: string) => refreshEngineModels(engine)))
  ipcMain.handle('ai:test', wrap((engine: string, creds: any) => testEngineConnection(engine, creds)))

  // AI operations
  ipcMain.handle('ai:billing', wrap(getAiBilling))
  ipcMain.handle('ai:sync-lore', wrap(syncLore))
  ipcMain.handle('ai:generate-summary', wrap((params: any) => generateSummary(params)))

  // Generation (legacy)
  ipcMain.handle('generate', wrap((data: any) => generate(data)))
  ipcMain.handle('generated-part:update', wrap((id: number, data: any) => updateGeneratedPart(id, data)))

  // Streaming
  ipcMain.handle('stream:start', (event, { streamId, endpoint, params }) => {
    startStreamHandler(event.sender, streamId, endpoint, params)
    return { ok: true }
  })

  ipcMain.handle('stream:abort', (_, { streamId }) => {
    const ac = activeStreams.get(streamId)
    if (ac) { ac.abort(); activeStreams.delete(streamId) }
    return { ok: true }
  })
}
