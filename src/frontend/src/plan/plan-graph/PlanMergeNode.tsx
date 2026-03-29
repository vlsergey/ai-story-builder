import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { PlanNodeRow } from '@shared/plan-graph'
import { dispatchOpenPlanNodeEditor } from '../../lib/plan-graph-events'
import PlanNodeStatusIcon from './PlanNodeStatusIcon'
import DeleteNodeButton from './DeleteNodeButton'

type PlanMergeNodeData = PlanNodeRow & { onDelete: (id: string) => void }

export default function PlanMergeNode({ data }: NodeProps) {
  const node = data as unknown as PlanMergeNodeData

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.onDelete(String(node.id))
  }

  return (
    <div
      className="bg-background border-2 border-blue-400 rounded shadow-sm w-[200px] cursor-pointer select-none group"
      onDoubleClick={(e) => { e.stopPropagation(); dispatchOpenPlanNodeEditor(node.id) }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-blue-500 text-sm">⊞</span>
            <span className="text-sm font-medium truncate">{node.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <PlanNodeStatusIcon status={node.status} />
            <DeleteNodeButton onDelete={handleDelete} />
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Merge</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
