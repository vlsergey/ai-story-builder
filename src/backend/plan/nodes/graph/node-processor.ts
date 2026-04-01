import type { NodeContext } from './node-interfaces.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeRow, PlanNodeUpdate } from '../../../../shared/plan-graph.js'
import { makeErrorWithStatus } from '../../../lib/make-errors.js'

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
  getOutput(planNodeRow: PlanNodeRow): unknown

  onUpdate?(context: NodeContext, nodeId: number, oldNode: PlanNodeRow | null, newNode: PlanNodeRow | null, settings: S): Promise<PlanNodeUpdate|null>

  /**
   * Called when an input node's content changes.
   * The processor may decide to update its own content (e.g., re‑merge, re‑split) if auto‑update is enabled.
   * Returns a PlanNodeRow object with updated fields (e.g., content) if the node should be updated,
   * or null if no changes are needed.
   * @param changedInputNodeId The ID of the input node whose content changed.
   * @param settings The full settings for this node (merged from node_type_settings and defaults).
   */
  onInputContentChange?(context: NodeContext, node: PlanNodeRow, changedInputNodeId: number, settings: S): Promise<PlanNodeUpdate | null>

  /**
   * Regenerate the node's content (e.g., AI generation, re‑split, re‑merge).
   * This method is also saves new content of the node.
   * Will return old planNodeRow if regeneration not required.
   */
  regenerate?(context: NodeContext, node: PlanNodeRow, settings: S): Promise<PlanNodeUpdate | null>
}

/**
 * Registry of node processors.
 */
export class NodeProcessorRegistry {
  private processors = new Map<PlanNodeType, NodeProcessor>()

  register(processor: NodeProcessor) {
    for (const type of processor.supportedTypes) {
      this.processors.set(type, processor)
    }
  }

  getProcessor(nodeType: PlanNodeType): NodeProcessor {
    const processor = this.findProcessor(nodeType)
    if (processor == null) {
      throw makeErrorWithStatus(`No processor for node type ${nodeType}`, 400)
    }
    return processor
  }

  findProcessor(nodeType: PlanNodeType): NodeProcessor | undefined {
    return this.processors.get(nodeType)
  }

  hasProcessor(nodeType: PlanNodeType): boolean {
    return this.processors.has(nodeType)
  }
}