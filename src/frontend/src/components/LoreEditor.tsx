import React from 'react'
import { dispatchLoreNodeSaved } from '../lib/lore-events'
import NodeEditor, { type NodeEditorAdapter } from './NodeEditor'
import { ipcClient } from '../ipcClient'

interface LoreEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
}

const loreAdapter: NodeEditorAdapter = {
  getNode: (id) => ipcClient.lore.get(id),
  patchNode: (id, data) => ipcClient.lore.patch(id, data),
  primaryField: 'name',
  i18nPrefix: 'lore',
  generateEndpoint: '/api/ai/generate-lore',
  onSaved: ({ nodeId, primaryValue, wordCount, charCount, byteCount, aiSyncInfo }) => {
    dispatchLoreNodeSaved({
      id: nodeId,
      name: primaryValue,
      wordCount,
      charCount,
      byteCount,
      aiSyncInfo: aiSyncInfo ?? null,
    })
  },
  supportsAutoSummary: false,
}

export default function LoreEditor({ nodeId, panelApi }: LoreEditorProps) {
  return <NodeEditor nodeId={nodeId} panelApi={panelApi} adapter={loreAdapter} />
}
