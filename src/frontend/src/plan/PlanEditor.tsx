import React, { useEffect } from 'react'
import { trpc } from '../ipcClient'
import PlanNodeTextEditor from './PlanTextNodeEditor'

interface PlanEditorProps {
  nodeId: number
  panelApi?: { setTitle: (title: string) => void }
}

export default function PlanEditor({ nodeId, panelApi }: PlanEditorProps) {
  const planNodeQuery = trpc.plan.nodes.get.useQuery(nodeId)

  const node = planNodeQuery.data

  useEffect(() => {
    if (panelApi && node) {
      panelApi.setTitle(node.title)
    }
  }, [panelApi, node])

  if (planNodeQuery.isLoading) {
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
        {/* <MergeNodeEditor
          node={node}
          onUpdate={(content) => {
            // Update the node content (manual edit)
            adapter.patchNode(nodeId, true, { content })
          }}
          panelApi={panelApi}
          onNodeUpdated={(updatedNode) => setNode(updatedNode)}
        /> */}
      </div>
    )
  }

  // For split nodes, show the SplitNodeEditor
  if (node.type === 'split') {
    return (
      <div className="h-full overflow-auto">
        {/* <SplitNodeEditor
          node={node}
          onUpdate={(content) => {
            // Update the node content (manual edit)
            adapter.patchNode(nodeId, true, { content })
          }}
          panelApi={panelApi}
          onNodeUpdated={(updatedNode) => setNode(updatedNode)}
        /> */}
      </div>
    )
  }

  return <div className="h-full overflow-auto">
    <PlanNodeTextEditor
      nodeId={nodeId}
      initialValue={node}
      />
  </div>
}
