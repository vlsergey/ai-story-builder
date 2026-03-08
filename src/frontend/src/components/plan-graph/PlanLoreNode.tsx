import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { PlanGraphNode } from '../../types/models'

export default function PlanLoreNode({ data }: NodeProps) {
  const node = data as unknown as PlanGraphNode

  return (
    <div className="bg-background border-2 border-purple-400 rounded shadow-sm w-[200px] cursor-default select-none">
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <div className="flex items-center gap-1.5">
          <span className="text-purple-500 text-sm">⬡</span>
          <span className="text-sm font-medium truncate">{node.title}</span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Lore</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
