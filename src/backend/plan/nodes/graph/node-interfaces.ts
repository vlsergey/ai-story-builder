import type { PlanEdgeRow, PlanNodeRow } from '../../../../shared/plan-graph.js'

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
  getNodeInputs(nodeId: number): Array<{
    edge: PlanEdgeRow,
    sourceNode: PlanNodeRow,
    input: unknown,
  }>
  getByParentId(parentId: number | null): PlanNodeRow[]
  getProcessor(nodeType: import('../../../../shared/plan-graph.js').PlanNodeType): import('./node-processor.js').NodeProcessor | undefined
}