import React, { useMemo } from 'react'
import { dispatchPlanNodeSaved } from '../lib/plan-events'
import { dispatchPlanGraphRefresh } from '../lib/plan-graph-events'
import NodeEditor, { type NodeEditorAdapter } from './NodeEditor'
import { ipcClient } from '../ipcClient'

interface PlanEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
}

export default function PlanEditor({ nodeId, panelApi }: PlanEditorProps) {
  const adapter = useMemo<NodeEditorAdapter>(() => ({
    getNode: (id) => ipcClient.plan.getNode(id),
    patchNode: (id, data) => ipcClient.plan.patchNode(id, data),
    primaryField: 'title',
    i18nPrefix: 'plan',
    generateEndpoint: '/api/ai/generate-plan',
    onSaved: ({ nodeId: id, primaryValue, wordCount, charCount, byteCount }) => {
      dispatchPlanNodeSaved({ id, title: primaryValue, wordCount, charCount, byteCount })
    },
    onAfterGenerate: dispatchPlanGraphRefresh,
    supportsAutoSummary: true,
  }), [])

  return <NodeEditor nodeId={nodeId} panelApi={panelApi} adapter={adapter} />
}
