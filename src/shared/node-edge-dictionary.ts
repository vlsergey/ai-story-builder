/**
 * Dictionary of node and edge types with compatibility rules.
 * Used for building models, dialogs, and backend validation.
 */

import { type PlanNodeType, type PlanEdgeType, type PlanContainerNodeType, EDGE_TYPES } from "./plan-graph.js"

export type PlanNodeParentContainerType = PlanContainerNodeType | "root"

export interface NodeTypeDefinition {
  id: PlanNodeType
  /** Where node can be placed (manually) */
  allowedContainers?: PlanNodeParentContainerType[]
  /** Edge types that can originate from this node */
  allowedOutgoingEdgeTypes: PlanEdgeType[]
  /** Edge types that can target this node */
  allowedIncomingEdgeTypes: PlanEdgeType[]
  /** Whether this node type can be created manually by user (default true) */
  canCreate?: boolean
  /** Whether this node type can be deleted manually by user (default true) */
  canDelete?: boolean
  canRegenerate?: boolean
  /** Whether this node type can be saved to file (default false) */
  canSaveToFile?: boolean
  /** Whether this node type is a group node (rendered as React Flow group) */
  isGroup?: boolean
  /** Whether this node is confined to its parent (cannot be moved outside parent bounds) */
  confined?: boolean
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
    id: "text",
    allowedOutgoingEdgeTypes: ["text"],
    allowedIncomingEdgeTypes: ["text"],
    canCreate: true,
    canDelete: true,
    canRegenerate: true,
    canSaveToFile: true,
  },
  {
    id: "lore",
    allowedOutgoingEdgeTypes: ["text"],
    allowedIncomingEdgeTypes: ["text"],
    canCreate: true,
    canDelete: true,
  },
  {
    id: "merge",
    allowedOutgoingEdgeTypes: ["text"],
    allowedIncomingEdgeTypes: ["text", "textArray"],
    canCreate: true,
    canDelete: true,
    canRegenerate: true,
    canSaveToFile: true,
  },
  {
    id: "split",
    allowedOutgoingEdgeTypes: ["textArray"],
    allowedIncomingEdgeTypes: ["text"],
    canCreate: true,
    canDelete: true,
    canRegenerate: true,
  },
  {
    id: "fix-problems",
    allowedOutgoingEdgeTypes: ["text"],
    allowedIncomingEdgeTypes: ["text"],
    canCreate: true,
    canDelete: true,
    isGroup: false,
    canRegenerate: true,
  },
  {
    id: "for-each",
    allowedOutgoingEdgeTypes: ["textArray"],
    allowedIncomingEdgeTypes: ["textArray"],
    canCreate: true,
    canDelete: true,
    isGroup: true,
    canRegenerate: true,
  },
  {
    id: "for-each-input",
    allowedContainers: ["for-each"],
    allowedIncomingEdgeTypes: [],
    allowedOutgoingEdgeTypes: ["text"],
    canCreate: false,
    canDelete: false,
    confined: true,
    canRegenerate: false,
  },
  {
    id: "for-each-output",
    allowedContainers: ["for-each"],
    allowedOutgoingEdgeTypes: [],
    allowedIncomingEdgeTypes: ["text"],
    canCreate: false,
    canDelete: false,
    confined: true,
    canRegenerate: true,
  },
  {
    id: "for-each-prev-outputs",
    allowedContainers: ["for-each"],
    allowedIncomingEdgeTypes: [],
    allowedOutgoingEdgeTypes: ["textArray"],
    canCreate: true,
    canDelete: true,
    confined: true,
    canRegenerate: true,
  },
] as const

// Edge type definitions
export const EDGE_TYPES_DEFS = EDGE_TYPES.map((edgeType) => ({
  id: edgeType,
  allowedSourceNodeTypes: NODE_TYPES.filter((t) => t.allowedOutgoingEdgeTypes.includes(edgeType)).map((t) => t.id),
  allowedTargetNodeTypes: NODE_TYPES.filter((t) => t.allowedIncomingEdgeTypes.includes(edgeType)).map((t) => t.id),
}))

export interface EdgeTypeToOutputTypeMap {
  text: string
  textArray: string[]
}

// Helper functions
export function isValidNodeType(type: string): type is PlanNodeType {
  return NODE_TYPES.some((nt) => nt.id === type)
}

export function isValidEdgeType(type: string): type is PlanEdgeType {
  return EDGE_TYPES_DEFS.some((et) => et.id === type)
}

export function canCreateEdge(
  sourceNodeType: PlanNodeType,
  targetNodeType: PlanNodeType,
  edgeType: PlanEdgeType,
): boolean {
  const edgeDef = EDGE_TYPES_DEFS.find((et) => et.id === edgeType)
  if (!edgeDef) return false
  if (!edgeDef.allowedSourceNodeTypes.includes(sourceNodeType)) return false
  if (!edgeDef.allowedTargetNodeTypes.includes(targetNodeType)) return false
  return true
}

export function getNodeTypeDefinition(type: PlanNodeType): NodeTypeDefinition | undefined {
  return NODE_TYPES.find((nt) => nt.id === type)
}

export function getEdgeTypeDefinition(type: PlanEdgeType): EdgeTypeDefinition | undefined {
  return EDGE_TYPES_DEFS.find((et) => et.id === type)
}

export function getCreatableNodeTypes(containerType: PlanNodeParentContainerType): PlanNodeType[] {
  return NODE_TYPES.filter((def) => def.canCreate !== false)
    .filter((def) => def.allowedContainers === undefined || def.allowedContainers.includes(containerType))
    .map((def) => def.id)
}
