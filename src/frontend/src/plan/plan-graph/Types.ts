import { PlanEdgeRow, PlanEdgeType, PlanNodeRow } from "@shared/plan-graph"
import type { Edge, Node } from "@xyflow/react"

export type NodeImpl = Node<
  PlanNodeRow & Record<string, unknown> & { onDelete: (nodeId: number) => void },
  "simple" | "group"
>

export type EdgeImpl = Edge<
  PlanEdgeRow & Record<string, unknown> & { onDelete: (nodeId: number) => void },
  PlanEdgeType
>
