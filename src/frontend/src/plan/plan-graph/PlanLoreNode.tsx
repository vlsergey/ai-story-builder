import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import PlanNodeStatusIcon from './PlanNodeStatusIcon'
import { PlanNodeRow } from '@shared/plan-graph'

type PlanLoreNodeData = PlanNodeRow & { onDelete: (id: string) => void }

export default function PlanLoreNode({ data }: NodeProps) {
  const node = data as unknown as PlanLoreNodeData

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.onDelete(String(node.id))
  }

  return (
    <div className="bg-background border-2 border-purple-400 rounded shadow-sm w-[200px] cursor-default select-none group">
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-purple-500 text-sm">⬡</span>
            <span className="text-sm font-medium truncate">{node.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <PlanNodeStatusIcon status={node.status} />
            <button
              onClick={handleDelete}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground hover:text-destructive bg-background border border-border rounded w-4 h-4 flex items-center justify-center"
              title="Delete node"
            >
              ×
            </button>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Lore</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
