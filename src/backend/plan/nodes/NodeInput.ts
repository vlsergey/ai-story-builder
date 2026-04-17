import type { PlanEdgeRow, PlanNodeRow } from "../../../shared/plan-graph"

export interface NodeInput<T> {
  edge: PlanEdgeRow
  sourceNode: PlanNodeRow
  input: T
}

export type NodeInputs<T> = NodeInput<T>[]
