import React, { useMemo, useState, useEffect } from 'react'
import { dispatchPlanNodeSaved } from '../lib/plan-events'
import { dispatchPlanGraphRefresh } from '../lib/plan-graph-events'
import NodeEditor, { type NodeEditorAdapter } from './NodeEditor'
import { ipcClient } from '../ipcClient'
import { type PlanGraphNode } from '../types/models'
import MergeNodeEditor from './MergeNodeEditor'
import SplitNodeEditor from './SplitNodeEditor'

interface PlanEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
}

export default function PlanEditor({ nodeId, panelApi }: PlanEditorProps) {
  const [node, setNode] = useState<PlanGraphNode | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    ipcClient.planGraph.getNode.query(nodeId).then(data => {
      setNode(data)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [nodeId])

  const adapter = useMemo<NodeEditorAdapter>(() => ({
    getNode: (id) => ipcClient.planGraph.getNode.query(id) as Promise<Record<string, any>>,
    patchNode: (id, data) => ipcClient.planGraph.patchNode.mutate({id, data}),
    primaryField: 'title',
    i18nPrefix: 'plan',
    generateEndpoint: '/api/ai/generate-plan',
    onSaved: ({ nodeId: id, primaryValue, wordCount, charCount, byteCount }) => {
      dispatchPlanNodeSaved({ id, title: primaryValue, wordCount, charCount, byteCount })
    },
    onAfterGenerate: dispatchPlanGraphRefresh,
    supportsAutoSummary: true,
  }), [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted-foreground text-sm">Loading...</span>
      </div>
    )
  }

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-destructive text-sm">Node not found</span>
      </div>
    )
  }

  // For merge nodes, show the MergeNodeEditor
  if (node.type === 'merge') {
    return (
      <div className="h-full overflow-auto">
        <MergeNodeEditor
          node={node}
          onUpdate={(content) => {
            // Update the node content (manual edit)
            adapter.patchNode(nodeId, { content }).then(() => {
              // Dispatch saved event
              adapter.onSaved({
                nodeId,
                wordCount: undefined,
                charCount: undefined,
                byteCount: undefined
              })
            })
          }}
          panelApi={panelApi}
          onNodeUpdated={(updatedNode) => setNode(updatedNode)}
        />
      </div>
    )
  }

  // For split nodes, show the SplitNodeEditor
  if (node.type === 'split') {
    return (
      <div className="h-full overflow-auto">
        <SplitNodeEditor
          node={node}
          onUpdate={(content) => {
            // Update the node content (manual edit)
            adapter.patchNode(nodeId, { content }).then(() => {
              // Dispatch saved event
              adapter.onSaved({
                nodeId,
                wordCount: undefined,
                charCount: undefined,
                byteCount: undefined
              })
            })
          }}
          panelApi={panelApi}
          onNodeUpdated={(updatedNode) => setNode(updatedNode)}
        />
      </div>
    )
  }

  return <NodeEditor nodeId={nodeId} panelApi={panelApi} adapter={adapter} />
}
