import { useEffect } from 'react'
import { trpc } from '../ipcClient'
import {NodeTypeEditors} from './NodeTypeEditors'

export interface PlanNodeEditorRouterProps {
  nodeId: number
  panelApi: { setTitle: (title: string) => void }
}

export default function PlanNodeEditorRouter({ nodeId, panelApi }: PlanNodeEditorRouterProps) {
  const planNodeQuery = trpc.plan.nodes.get.useQuery(nodeId)
  const node = planNodeQuery.data

  useEffect(() => {
    if (node?.title) {
      panelApi.setTitle(node?.title || '')
    }
  }, [panelApi, node?.title])

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

  const NodeTypeEditor = NodeTypeEditors[node.type]
  if (!NodeTypeEditor) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-destructive text-sm">Node type not supported</span>
      </div>
    )
  }

  return <div className="h-full overflow-auto">
    <NodeTypeEditor
      nodeId={nodeId}
      initialValue={node}
      />
  </div>
}
