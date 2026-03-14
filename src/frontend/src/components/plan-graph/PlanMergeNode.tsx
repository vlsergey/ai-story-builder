import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useLocale } from '../../lib/locale'
import type { PlanGraphNode } from '../../types/models'
import { dispatchOpenPlanNodeEditor } from '../../lib/plan-graph-events'

type PlanMergeNodeData = PlanGraphNode & { onDelete: (id: string) => void }

export default function PlanMergeNode({ data }: NodeProps) {
  const { t } = useLocale()
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
          <button
            onClick={handleDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground hover:text-destructive bg-background border border-border rounded w-4 h-4 flex items-center justify-center"
            title="Delete node"
          >
            ×
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Merge</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}