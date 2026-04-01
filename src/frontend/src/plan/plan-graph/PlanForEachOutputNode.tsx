import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { SquareArrowRightEnterIcon } from 'lucide-react'
import { PlanNodeRow } from '@shared/plan-graph'

export default function PlanForEachOutputNode({data} : ({data: PlanNodeRow})) {
  return (
    <div className="w-full h-full bg-background border-2 border-purple-400 rounded shadow-sm cursor-default select-none group">
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <SquareArrowRightEnterIcon className='shrink-0 h-full w-full text-muted-foreground/70'/>
      </div>
    </div>
  )
}

PlanForEachOutputNode.fixedWidth = 40
PlanForEachOutputNode.fixedHeight = 40