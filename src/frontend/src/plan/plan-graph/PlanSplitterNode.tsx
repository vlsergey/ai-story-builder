import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { PlanNodeRow } from '@shared/plan-graph'
import { dispatchOpenPlanNodeEditor } from '../../lib/plan-graph-events'
import PlanNodeStatusIcon from './PlanNodeStatusIcon'
import DeleteNodeButton from './DeleteNodeButton'
import { SplitIcon } from 'lucide-react'

type PlanSplitterNodeData = PlanNodeRow & { onDelete: (id: number) => void }

export default function PlanSplitterNode({ data }: NodeProps) {
  const node = data as unknown as PlanSplitterNodeData

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.onDelete(node.id)
  }

  return (
    <div
      className="bg-background border-2 border-blue-400 rounded shadow-sm w-[200px] cursor-pointer select-none group"
      onDoubleClick={(e) => { e.stopPropagation(); dispatchOpenPlanNodeEditor(node.id) }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <div className="flex items-center justify-between gap-1 mb-1">
          <div className="flex items-center gap-1.5">
            <SplitIcon className='shrink-0 w-4 h-4 text-muted-foreground/70'/>
            <span className="text-sm font-medium leading-tight truncate flex-1">{node.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <PlanNodeStatusIcon status={node.status} />
            <DeleteNodeButton onDelete={handleDelete} />
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {node.word_count > 0 ? `${node.word_count}w` : null}
          {node.summary && (
            <div
              className="truncate mt-0.5 text-muted-foreground/70"
              title={node.summary}>{node.summary}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
