import { PlanNodeService } from '../plan-node-service.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import { AiRegenerateOptions } from '../../../../shared/ai-regenerate-all.js'

/**
 * Processor for a specific node type.
 * Knows how to compute outputs, react to changes, and regenerate content.
 */
export interface NodeProcessor<S = unknown> {
  /** Node types this processor can handle */
  readonly supportedTypes: PlanNodeType[]

  /** Edge types that this node accepts as inputs */
  getInputEdgeTypes(): PlanEdgeType[]

  /** Edge type that this node produces as output (each node has exactly one output edge type) */
  getOutputEdgeType(): PlanEdgeType

  /**
   * Default settings for this node type.
   * These settings are used when node_type_settings is null or missing fields.
   */
  readonly defaultSettings: S

  /**
   * Get output for the given node.
   * Returns the current content of the node without updating or recomputing it.
   * The output must match the type expected by the edge (e.g., string for 'text', string[] for 'textArray').
   * The edge type is determined by getOutputEdgeType().
   */
  getOutput(context: PlanNodeService, planNodeRow: PlanNodeRow): unknown

  onUpdate?(context: PlanNodeService, nodeId: number, oldNode: PlanNodeRow | null, newNode: PlanNodeRow | null, settings: S): Promise<PlanNodeUpdate|null>

  /**
   * Called when an input node's content changes.
   * The processor may decide to update its own content (e.g., re‑merge, re‑split) if auto‑update is enabled.
   * Returns a PlanNodeRow object with updated fields (e.g., content) if the node should be updated,
   * or null if no changes are needed.
   * @param changedInputNodeId The ID of the input node whose content changed.
   * @param settings The full settings for this node (merged from node_type_settings and defaults).
   */
  onInputContentChange?(context: PlanNodeService, node: PlanNodeRow, changedInputNodeId: number, settings: S): Promise<PlanNodeUpdate | null>

  /**
   * Regenerate the node's content (e.g., AI generation, re‑split, re‑merge).
   * This method is also saves new content of the node.
   * Will return old planNodeRow if regeneration not required.
   */
  regenerate?(
    context: PlanNodeService,
    regenerateAllOptions: AiRegenerateOptions,
    node: PlanNodeRow,
    settings: S
  ): Promise<PlanNodeUpdate | null>
}
