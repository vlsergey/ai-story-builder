import React from 'react'
import NodeEditor, { type NodeEditorAdapter } from '../nodes/NodeEditor'
import { ipcClient } from '../ipcClient'

interface LoreEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
}

const loreAdapter: NodeEditorAdapter = {
  getNode: (id) => ipcClient.lore.get.query(id) as Promise<Record<string, any>>,
  patchNode: (id, data) => ipcClient.lore.patch.mutate({id, data}),
  primaryField: 'name',
  i18nPrefix: 'lore',
  generateEndpoint: '/api/ai/generate-lore',
  supportsAutoSummary: false,
}

export default function LoreEditor({ nodeId, panelApi }: LoreEditorProps) {
  return <NodeEditor nodeId={nodeId} panelApi={panelApi} adapter={loreAdapter} />
}
