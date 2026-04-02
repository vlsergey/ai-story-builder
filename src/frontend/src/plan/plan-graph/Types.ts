import { PlanNodeRow } from "@shared/plan-graph";
import type { Node } from '@xyflow/react'

export type NodeImpl = Node<
  PlanNodeRow & Record<string, unknown> & { onDelete: (nodeId: number) => void },
  'simple' | 'group'>
