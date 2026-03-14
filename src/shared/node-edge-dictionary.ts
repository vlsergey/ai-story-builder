/**
 * Dictionary of node and edge types with compatibility rules.
 * Used for building models, dialogs, and backend validation.
 */

import type { PlanNodeType, PlanEdgeType } from './plan-graph.js'

export interface NodeTypeDefinition {
  id: PlanNodeType
  /** Edge types that can originate from this node */
  allowedOutgoingEdgeTypes: PlanEdgeType[]
  /** Edge types that can target this node */
  allowedIncomingEdgeTypes: PlanEdgeType[]
}

export interface EdgeTypeDefinition {
  id: PlanEdgeType
  /** Node types that can be the source of this edge */
  allowedSourceNodeTypes: PlanNodeType[]
  /** Node types that can be the target of this edge */
  allowedTargetNodeTypes: PlanNodeType[]
}

// Node type definitions
export const NODE_TYPES: NodeTypeDefinition[] = [
  {
    id: 'text',
    allowedOutgoingEdgeTypes: ['instruction', 'attachment', 'system_prompt', 'merge_into'],
    allowedIncomingEdgeTypes: ['instruction', 'attachment', 'system_prompt'],
  },
  {
    id: 'lore',
    allowedOutgoingEdgeTypes: ['instruction', 'attachment', 'system_prompt', 'merge_into'],
    allowedIncomingEdgeTypes: ['instruction', 'attachment', 'system_prompt'],
  },
  {
    id: 'merge',
    allowedOutgoingEdgeTypes: ['instruction', 'attachment', 'system_prompt', 'merge_into'],
    allowedIncomingEdgeTypes: ['instruction', 'attachment', 'system_prompt', 'merge_into'],
  },
]

// Edge type definitions
export const EDGE_TYPES: EdgeTypeDefinition[] = [
  {
    id: 'instruction',
    allowedSourceNodeTypes: ['text', 'lore', 'merge'],
    allowedTargetNodeTypes: ['text', 'lore', 'merge'],
  },
  {
    id: 'attachment',
    allowedSourceNodeTypes: ['text', 'lore', 'merge'],
    allowedTargetNodeTypes: ['text', 'lore', 'merge'],
  },
  {
    id: 'system_prompt',
    allowedSourceNodeTypes: ['text', 'lore', 'merge'],
    allowedTargetNodeTypes: ['text', 'lore', 'merge'],
  },
  {
    id: 'merge_into',
    allowedSourceNodeTypes: ['text', 'lore', 'merge'],
    allowedTargetNodeTypes: ['merge'],
  },
]

// Helper functions
export function isValidNodeType(type: string): type is PlanNodeType {
  return NODE_TYPES.some(nt => nt.id === type)
}

export function isValidEdgeType(type: string): type is PlanEdgeType {
  return EDGE_TYPES.some(et => et.id === type)
}

export function canCreateEdge(
  sourceNodeType: PlanNodeType,
  targetNodeType: PlanNodeType,
  edgeType: PlanEdgeType
): boolean {
  const edgeDef = EDGE_TYPES.find(et => et.id === edgeType)
  if (!edgeDef) return false
  if (!edgeDef.allowedSourceNodeTypes.includes(sourceNodeType)) return false
  if (!edgeDef.allowedTargetNodeTypes.includes(targetNodeType)) return false
  return true
}

export function getNodeTypeDefinition(type: PlanNodeType): NodeTypeDefinition | undefined {
  return NODE_TYPES.find(nt => nt.id === type)
}

export function getEdgeTypeDefinition(type: PlanEdgeType): EdgeTypeDefinition | undefined {
  return EDGE_TYPES.find(et => et.id === type)
}