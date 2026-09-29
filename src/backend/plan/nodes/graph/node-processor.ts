import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"

/**
 * Processor for a specific node type.
 * Knows how to compute outputs, react to changes, and regenerate content —
 * always for one iteration: the row it gets is the node at a path.
 */
export interface NodeProcessor<S = unknown> {
  /**
   * Default settings for this node type.
   * These settings are used when node_type_settings is null or missing fields.
   */
  readonly defaultSettings: S

  /**
   * The node's output at `row.path`, without recomputing it.
   * The output must match the type expected by the edge (e.g., string for 'text', string[] for 'textArray').
   */
  getOutput(service: PlanNodeService, row: PlanNodeRow): unknown

  /**
   * Called when an input node's content changed; `row` is this node at a path
   * that reads it. Returns the change to this node's state there, or null.
   * @param changedInputNodeId The ID of the input node whose content changed.
   * @param settings The full settings for this node (merged from node_type_settings and defaults).
   */
  onInputContentChange?(
    service: PlanNodeService,
    row: PlanNodeRow,
    changedInputNodeId: number,
    settings: S,
  ): Promise<PlanNodeStateUpdate | null>

  /**
   * Regenerates the node at `row.path` (e.g. AI generation, re-split, re-merge)
   * and returns its new state; the service stores it.
   */
  regenerate?(
    service: PlanNodeService,
    context: RegenerationNodeContext,
    row: PlanNodeRow,
    settings: S,
  ): Promise<PlanNodeStateUpdate | null>
}
