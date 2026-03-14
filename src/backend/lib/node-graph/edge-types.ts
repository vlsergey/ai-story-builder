import type { PlanEdgeType } from '../../../shared/plan-graph.js'

/**
 * Base interface for edge type definitions.
 * Each edge type can define how to retrieve its data from a source node.
 */
export interface EdgeTypeDefinition {
  id: PlanEdgeType
  /** Human-readable name */
  name: string
  /** Description */
  description?: string
}

/**
 * Edge type: text
 */
export const textEdgeType: EdgeTypeDefinition = {
  id: 'text',
  name: 'Text',
  description: 'Single text content',
}

/**
 * Edge type: textArray
 */
export const textArrayEdgeType: EdgeTypeDefinition = {
  id: 'textArray',
  name: 'Text Array',
  description: 'Array of texts (multiple parts)',
}

/**
 * Registry of all edge types.
 */
export const EDGE_TYPES: EdgeTypeDefinition[] = [
  textEdgeType,
  textArrayEdgeType,
]

/**
 * Get edge type definition by ID.
 */
export function getEdgeTypeDefinition(id: PlanEdgeType): EdgeTypeDefinition | undefined {
  return EDGE_TYPES.find(et => et.id === id)
}