import type { PlanEdgeRow, PlanNodeRow } from "@shared/plan-graph"
import type { PlanEdgeType } from "@shared/plan-edge-types"
import type { Edge, Node } from "@xyflow/react"

export type NodeImpl = Node<
  PlanNodeRow & Record<string, unknown> & { onDelete: (nodeId: number) => void },
  "simple" | "group"
>

export type EdgeImpl = Edge<
  PlanEdgeRow & Record<string, unknown> & { onDelete: (nodeId: number) => void },
  PlanEdgeType
>
