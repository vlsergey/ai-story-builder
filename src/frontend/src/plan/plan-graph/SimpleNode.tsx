import React, { type MouseEventHandler, useCallback, useMemo } from "react"
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react"
import { dispatchOpenPlanNodeEditor } from "../../lib/plan-graph-events"
import PlanNodeStatusIcon from "./PlanNodeStatusIcon"
import DeleteNodeButton from "./DeleteNodeButton"
import type { NodeImpl } from "./Types"
import { getNodeTypeDefinition } from "@shared/node-edge-dictionary"
import NodeTypeIcons from "./NodeTypeIcons"
import { NodeTypeEditors } from "../editors/NodeTypeEditors"

export default function SimpleNode({ data }: NodeProps<NodeImpl>) {
  const nodeType = useMemo(() => getNodeTypeDefinition(data.type), [data.type])
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    data.onDelete(data.id)
  }

  const hasInputs = (nodeType?.allowedIncomingEdgeTypes || []).length > 0
  const hasOutputs = (nodeType?.allowedOutgoingEdgeTypes || []).length > 0

  const handleDoubleClick = useCallback<MouseEventHandler>(
    (e) => {
      if (NodeTypeEditors[data.type]) {
        e.stopPropagation()
        dispatchOpenPlanNodeEditor(data)
      }
    },
    [data],
  )

  return (
    <div
      className="bg-background border-2 border-blue-400 rounded shadow-sm cursor-pointer select-none h-full w-full"
      onDoubleClick={handleDoubleClick}
    >
      {hasInputs && <Handle type="target" position={Position.Left} />}
      <NodeResizer isVisible={true} />
      <div className="p-2 flex flex-col h-full w-full">
        <div className="shrink-0 flex items-center justify-between gap-1 mb-1">
          {React.createElement(NodeTypeIcons[data.type], { className: "shrink-0 w-4 h-4 text-muted-foreground/70" })}
          <span className="text-sm font-medium leading-tight truncate flex-1">{data.title}</span>
          <div className="flex items-center gap-1">
            <PlanNodeStatusIcon status={data.status} />
            <DeleteNodeButton onDelete={handleDelete} />
          </div>
        </div>
        <div className="flex-1 text-[11px] text-muted-foreground overflow-hidden">
          {data.word_count > 0 ? `${data.word_count}w` : null}
          {data.summary && (
            <div className="mt-0.5" title={data.summary}>
              {data.summary}
            </div>
          )}
        </div>
      </div>
      {hasOutputs && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
