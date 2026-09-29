import React, { type MouseEventHandler, useCallback, useMemo } from "react"
import { dispatchOpenPlanNodeEditor } from "../../lib/plan-graph-events"
import { NodeTypeEditors } from "../editors/NodeTypeEditors"
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react"
import PlanNodeStatusIcon from "./PlanNodeStatusIcon"
import DeleteNodeButton from "./DeleteNodeButton"
import type { NodeImpl } from "./Types"
import { getNodeTypeDefinition } from "@shared/node-edge-dictionary"
import ForEachPlanNodeFooter from "./ForEachPlanNodeFooter"
import CreateNodeButtonGroup from "./CreateNodeButtonGroup"
import type { PlanContainerNodeType } from "@shared/plan-node-types"
import { LOOP_TYPES, useNodeDisplayState } from "../iteration-selection"
import NodeTypeIcons from "./NodeTypeIcons"

const NO_KEYS: string[] = []

export default function GroupNode({ data }: NodeProps<NodeImpl>) {
  const nodeType = useMemo(() => getNodeTypeDefinition(data.type), [data.type])
  const { path, state } = useNodeDisplayState(data.id)
  const handleDoubleClick = useCallback<MouseEventHandler>(
    (e) => {
      if (NodeTypeEditors[data.type]) {
        e.stopPropagation()
        dispatchOpenPlanNodeEditor(data, path)
      }
    },
    [data, path],
  )
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    data.onDelete(data.id)
  }

  const hasInputs = (nodeType?.allowedIncomingEdgeTypes || []).length > 0
  const hasOutputs = (nodeType?.allowedOutgoingEdgeTypes || []).length > 0

  return (
    <div
      className="bg-background border-2 border-blue-400 rounded shadow-sm cursor-pointer select-none group h-full w-full"
      onDoubleClick={handleDoubleClick}
    >
      {hasInputs && <Handle type="target" position={Position.Left} />}
      <NodeResizer isVisible={true} />
      <div className="p-2 flex flex-col h-full w-full">
        <div className="shrink-0 flex items-center justify-between gap-1 mb-1">
          {React.createElement(NodeTypeIcons[data.type], { className: "shrink-0 w-4 h-4 text-muted-foreground/70" })}
          <span className="text-sm font-medium leading-tight truncate flex-1">{data.title}</span>
          <div className="flex items-center gap-1">
            <PlanNodeStatusIcon status={state?.status ?? "EMPTY"} />
            <DeleteNodeButton onDelete={handleDelete} />
          </div>
        </div>
        <CreateNodeButtonGroup compact parentNode={{ id: Number(data.id), type: data.type as PlanContainerNodeType }} />
        <div className="flex-1" />
        {LOOP_TYPES.has(data.type) && (
          <div className="shrink-0">
            <ForEachPlanNodeFooter loopId={data.id} path={path} iterationKeys={state?.iterationKeys ?? NO_KEYS} />
          </div>
        )}
      </div>
      {hasOutputs && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
