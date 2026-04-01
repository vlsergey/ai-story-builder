import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { SquareArrowRightExitIcon } from 'lucide-react'
import { PlanNodeRow } from '@shared/plan-graph'

export default function PlanForEachInputNode({data} : ({data: PlanNodeRow})) {
  return (
    <div className="w-full h-full bg-background border-2 border-purple-400 rounded shadow-sm cursor-default select-none group">
      <div className="p-2">
        <SquareArrowRightExitIcon className='shrink-0 h-full w-full text-muted-foreground/70'/>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

PlanForEachInputNode.fixedWidth = 40
PlanForEachInputNode.fixedHeight = 40