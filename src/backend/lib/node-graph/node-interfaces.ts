import type { PlanNodeType } from '../../../shared/plan-graph.js'

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
 * Base node data.
 */
export interface NodeData {
  id: number
  type: PlanNodeType
  title: string
  content: string | null
  user_prompt: string | null
  system_prompt: string | null
  // other fields as needed
}

/**
 * Context passed to node instances for retrieving related data.
 */
export interface NodeContext {
  getNode(id: number): NodeData | undefined
  getIncomingEdges(nodeId: number): Array<{ from_node_id: number; type: string }>
  getOutgoingEdges(nodeId: number): Array<{ to_node_id: number; type: string }>
  // Additional helper methods can be added
}