import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useLocale } from '../../lib/locale'
import type { PlanGraphNode } from '../../types/models'
import { dispatchOpenPlanNodeEditor } from '../../lib/plan-graph-events'

export default function PlanMergeNode({ data }: NodeProps) {
  const { t } = useLocale()
  const node = data as unknown as PlanGraphNode

  return (
    <div
      className="bg-background border-2 border-blue-400 rounded shadow-sm w-[200px] cursor-pointer select-none"
      onDoubleClick={(e) => { e.stopPropagation(); dispatchOpenPlanNodeEditor(node.id) }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <div className="flex items-center gap-1.5">
          <span className="text-blue-500 text-sm">⊞</span>
          <span className="text-sm font-medium truncate">{node.title}</span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Merge</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}