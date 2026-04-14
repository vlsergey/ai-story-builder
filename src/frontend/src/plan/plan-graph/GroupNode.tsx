import React, { useMemo } from "react"
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react"
import PlanNodeStatusIcon from "./PlanNodeStatusIcon"
import DeleteNodeButton from "./DeleteNodeButton"
import { RepeatIcon } from "lucide-react"
import { NodeImpl } from "./Types"
import { getNodeTypeDefinition } from "@shared/node-edge-dictionary"
import ForEachPlanNodeFooter from "./ForEachPlanNodeFooter"
import CreateNodeButtonGroup from "./CreateNodeButtonGroup"
import { PlanContainerNodeType } from "@shared/plan-graph"

export default function GroupNode({ data }: NodeProps<NodeImpl>) {
  const nodeType = useMemo(() => getNodeTypeDefinition(data.type), [data.type])
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    data.onDelete(data.id)
  }

  const hasInputs = (nodeType?.allowedIncomingEdgeTypes || []).length > 0
  const hasOutputs = (nodeType?.allowedOutgoingEdgeTypes || []).length > 0

  return (
    <div className="bg-background border-2 border-blue-400 rounded shadow-sm cursor-pointer select-none group h-full w-full">
      {hasInputs && <Handle type="target" position={Position.Left} />}
      <NodeResizer isVisible={true} />
      <div className="p-2 flex flex-col h-full w-full">
        <div className="shrink-0 flex items-center justify-between gap-1 mb-1">
          <RepeatIcon className="shrink-0 w-4 h-4 text-muted-foreground/70" />
          <span className="text-sm font-medium leading-tight truncate flex-1">{data.title}</span>
          <div className="flex items-center gap-1">
            <PlanNodeStatusIcon status={data.status} />
            <DeleteNodeButton onDelete={handleDelete} />
          </div>
        </div>
        <CreateNodeButtonGroup compact parentNode={{ id: Number(data.id), type: data.type as PlanContainerNodeType }} />
        <div className="flex-1" />
        {nodeType?.id === "for-each" && (
          <div className="shrink-0">
            <ForEachPlanNodeFooter node={data} />
          </div>
        )}
      </div>
      {hasOutputs && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
