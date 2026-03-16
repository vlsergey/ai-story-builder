import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useLocale } from '../../lib/locale'
import type { PlanGraphNode } from '../../types/models'
import { dispatchOpenPlanNodeEditor } from '../../lib/plan-graph-events'
import PlanNodeStatusIcon from './PlanNodeStatusIcon'

type PlanSplitterNodeData = PlanGraphNode & { onDelete: (id: string) => void }

export default function PlanSplitterNode({ data }: NodeProps) {
  const { t } = useLocale()
  const node = data as unknown as PlanSplitterNodeData

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.onDelete(String(node.id))
  }

  return (
    <div
      className="bg-background border border-border rounded shadow-sm w-[200px] cursor-pointer select-none hover:border-primary/60 transition-colors group"
      onDoubleClick={(e) => { e.stopPropagation(); dispatchOpenPlanNodeEditor(node.id) }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <div className="flex items-start justify-between gap-1 mb-1">
          <span className="text-sm font-medium leading-tight truncate flex-1">{node.title}</span>
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
        <div className="text-[11px] text-muted-foreground">
          {node.content && (
            <div className="truncate mt-0.5 text-muted-foreground/70">
              Regex: {node.content}
            </div>
          )}
          {node.word_count > 0 ? `${node.word_count}w` : null}
          {node.summary && (
            <div className="truncate mt-0.5 text-muted-foreground/70">{node.summary}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}