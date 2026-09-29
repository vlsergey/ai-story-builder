import type { PlanEdgeRow, PlanNodeDefinition } from "@shared/plan-graph"
import type { PlanEdgeType } from "@shared/plan-edge-types"
import type { Edge, Node } from "@xyflow/react"

/** A graph node is the node's definition: the same in every iteration. Its state is read per iteration. */
export type NodeImpl = Node<
  PlanNodeDefinition & Record<string, unknown> & { onDelete: (nodeId: number) => void },
  "simple" | "group"
>

export type EdgeImpl = Edge<
  PlanEdgeRow & Record<string, unknown> & { onDelete: (nodeId: number) => void },
  PlanEdgeType
>
