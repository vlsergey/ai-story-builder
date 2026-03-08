import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useLocale } from '../../lib/locale'
import type { PlanGraphNode } from '../../types/models'

export default function PlanTextNode({ data }: NodeProps) {
  const { t } = useLocale()
  const node = data as unknown as PlanGraphNode

  const status = node.changes_status === 'review'
    ? t('planGraph.node.review')
    : node.word_count > 0
      ? t('planGraph.node.generated')
      : t('planGraph.node.notGenerated')

  const statusColor = node.changes_status === 'review'
    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
    : node.word_count > 0
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : 'bg-muted text-muted-foreground'

  return (
    <div
      className="bg-background border border-border rounded shadow-sm w-[200px] cursor-pointer select-none hover:border-primary/60 transition-colors"
    >
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <div className="flex items-start justify-between gap-1 mb-1">
          <span className="text-sm font-medium leading-tight truncate flex-1">{node.title}</span>
          <span className={`text-[10px] px-1 py-0.5 rounded shrink-0 font-medium ${statusColor}`}>
            {status}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
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
