import type { PlanEdgeType, PlanNodeRow } from '../../../../shared/plan-graph.js'

/**
 * Interface for nodes that can produce a single text output (for 'text' edges).
 */
export interface TextOutputNode {
  getOutputText(): string
}

/**
 * Interface for nodes that can produce an array of texts (for 'textArray' edges).
 */
export interface TextArrayOutputNode {
  getOutputTexts(): string[]
}

/**
 * Context passed to node instances for retrieving related data.
 */
export interface NodeContext {
  getById(id: number): PlanNodeRow | undefined
  getIncomingEdges(nodeId: number): Array<{ from_node_id: number; type: PlanEdgeType }>
  getOutgoingEdges(nodeId: number): Array<{ to_node_id: number; type: PlanEdgeType }>
  getNodeInputsRaw(nodeId: number): Array<{
    edgeType: PlanEdgeType
    sourceNodeId: number
    output: unknown
  }>
}