import type { PlanEdgeType } from "./plan-edge-types.js"
import type { NodePath } from "./plan-node-path.js"
import type { PlanNodeType } from "./plan-node-types.js"

export const PLAN_NODE_STATUSES = ["EMPTY", "GENERATING", "GENERATED", "MANUAL", "OUTDATED", "ERROR"] as const
export type PlanNodeStatus = (typeof PLAN_NODE_STATUSES)[number]

/** What a node is: edited in the graph, the same in every iteration of its loops. */
export interface PlanNodeDefinition {
  id: number
  type: PlanNodeType
  title: string
  parent_id: number | null
  position: number | null
  node_type_settings: string | null
  ai_settings: string | null
  x: number
  y: number
  width: number | null
  height: number | null
  created_at: string
}

/** What a node produced in one iteration of its loops. */
export interface PlanNodeState {
  content: string | null
  summary: string | null
  status: PlanNodeStatus
  word_count: number
  char_count: number
  byte_count: number
  in_review: 0 | 1
  review_base_content: string | null
  ai_improve_instruction: string | null
  /** Replaced on every write; an operation that started from one lands only if it still matches. */
  rev: string
}

/** A node as one iteration sees it: its definition and its state at `path`. */
export interface PlanNodeRow extends PlanNodeDefinition, PlanNodeState {
  path: NodePath
}

export const PLAN_NODE_DEFINITION_KEYS = [
  "title",
  "parent_id",
  "position",
  "node_type_settings",
  "ai_settings",
  "x",
  "y",
  "width",
  "height",
] as const satisfies readonly (keyof PlanNodeDefinition)[]

export const PLAN_NODE_STATE_KEYS = [
  "content",
  "summary",
  "status",
  "word_count",
  "char_count",
  "byte_count",
  "in_review",
  "review_base_content",
  "ai_improve_instruction",
] as const satisfies readonly (keyof PlanNodeState)[]

export type PlanNodeDefinitionUpdate = Partial<Pick<PlanNodeDefinition, (typeof PLAN_NODE_DEFINITION_KEYS)[number]>>
export type PlanNodeStateUpdate = Partial<Pick<PlanNodeState, (typeof PLAN_NODE_STATE_KEYS)[number]>>
/** What an editor sends: definition and state fields together; the service splits them. */
export type PlanNodeUpdate = PlanNodeDefinitionUpdate & PlanNodeStateUpdate

/** A new node's definition. */
export type PlanNodeDefinitionCreate = Pick<PlanNodeDefinition, "title"> &
  Partial<Pick<PlanNodeDefinition, "type" | (typeof PLAN_NODE_DEFINITION_KEYS)[number]>>

/** A new node; the state fields seed its row when it sits outside any loop. */
export type PlanNodeCreate = PlanNodeDefinitionCreate & PlanNodeStateUpdate

/** What the graph shows of a node in one iteration: its state without the texts. */
export interface PlanNodeStateBrief
  extends Pick<PlanNodeState, "status" | "summary" | "word_count" | "char_count" | "byte_count" | "in_review" | "rev"> {
  node_id: number
  path: NodePath
  /** For a loop: its iterations at this path, as the keys its children's paths use. */
  iterationKeys?: string[]
}

/**
 * A node in one iteration, as an editor opens it. `current` is false while the
 * loop does not have that iteration — it has not run yet, or the element is
 * gone; `movedTo` names the iteration it became when a parallel loop's key grew.
 */
export interface PlanNodeInIteration extends PlanNodeRow {
  current: boolean
  movedTo: string | null
}

export interface PlanEdgeRow {
  id: number
  from_node_id: number
  to_node_id: number
  type: PlanEdgeType
  position: number
  label: string | null
  template: string | null
}

type PlanEdgeInsert = Omit<PlanEdgeRow, "id">

export const PlanEdgeRowDefaults: Partial<PlanEdgeInsert> = {
  type: "text",
  position: 0,
  label: null,
  template: null,
}

type DefaultPlanEdgeKeys = keyof typeof PlanEdgeRowDefaults
export type PlanEdgeCreate = Omit<PlanEdgeInsert, DefaultPlanEdgeKeys> &
  Partial<Pick<PlanEdgeInsert, DefaultPlanEdgeKeys>>
export type PlanEdgeUpdate = Partial<PlanEdgeInsert>

export interface PlanGraphData {
  nodes: PlanNodeRow[]
  edges: PlanEdgeRow[]
}
