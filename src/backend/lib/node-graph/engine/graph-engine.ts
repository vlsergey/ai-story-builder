import type { Database } from 'better-sqlite3'
import { GraphManager } from '../graph-manager.js'
import { NodeProcessorRegistry } from './node-processor.js'
import { TextProcessor } from './text-processor.js'
import { LoreProcessor } from './lore-processor.js'
import { SplitProcessor } from './split-processor.js'
import { MergeProcessor } from './merge-processor.js'
import type { PlanNodeType, PlanEdgeType } from '../../../../shared/plan-graph'

/**
 * Extended graph manager that uses node processors for advanced operations.
 */
export class GraphEngine extends GraphManager {
  private processorRegistry: NodeProcessorRegistry

  constructor(db: Database) {
    super(db)
    this.processorRegistry = new NodeProcessorRegistry()
    this.registerDefaultProcessors()
  }

  private registerDefaultProcessors() {
    this.processorRegistry.register(new TextProcessor())
    this.processorRegistry.register(new LoreProcessor())
    this.processorRegistry.register(new SplitProcessor())
    this.processorRegistry.register(new MergeProcessor())
  }

  /**
   * Get the processor for a given node type.
   */
  getProcessor(nodeType: PlanNodeType) {
    return this.processorRegistry.getProcessor(nodeType)
  }

  /**
   * Get the raw inputs for a node (without expansion).
   * Each input includes edge type, source node id, and the source node's output for that edge type.
   */
  getNodeInputsRaw(nodeId: number): Array<{
    edgeType: PlanEdgeType
    sourceNodeId: number
    output: unknown
  }> {
    const edges = this.getIncomingEdges(nodeId)
    const inputs = []
    for (const edge of edges) {
      const sourceNode = this.getNode(edge.from_node_id)
      if (!sourceNode) continue
      const processor = this.getProcessor(sourceNode.type)
      if (!processor) continue
      const output = processor.getOutput(sourceNode)
      // Verify that the edge type matches the processor's output edge type
      if (processor.getOutputEdgeType() !== edge.type) {
        // This edge is not the output type of the source node, skip
        continue
      }
      inputs.push({
        edgeType: edge.type,
        sourceNodeId: edge.from_node_id,
        output,
      })
    }
    // Sort by edge position? (not implemented)
    return inputs
  }

  /**
   * Get the output of a node for a specific edge type.
   */
  getNodeOutput(nodeId: number, edgeType: PlanEdgeType): unknown {
    const node = this.getNode(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    const processor = this.getProcessor(node.type)
    if (!processor) throw new Error(`No processor for node type ${node.type}`)
    const output = processor.getOutput(node)
    // Verify that the requested edge type matches the processor's output edge type
    if (processor.getOutputEdgeType() !== edgeType) {
      throw new Error(`Node ${nodeId} does not produce edge type ${edgeType}`)
    }
    return output
  }

  /**
   * Update node content and trigger any downstream updates (e.g., auto‑update merge nodes).
   */
  async updateNodeContent(nodeId: number, newContent: string): Promise<void> {
    const node = this.getNode(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    const oldContent = node.content

    // Update in database
    await this.updateNodeContentInDb(nodeId, newContent)

    // Notify the node's own processor
    const processor = this.getProcessor(node.type)
    if (processor?.onContentChange) {
      await processor.onContentChange(this, node, oldContent)
    }

    // Notify downstream nodes
    await this.notifyDownstreamNodes(nodeId)
  }

  /**
   * Regenerate node content (e.g., AI generation, re‑split, re‑merge).
   * Returns new content if regeneration succeeded, otherwise null.
   */
  async regenerateNode(nodeId: number, options?: unknown): Promise<string | null> {
    const node = this.getNode(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    const processor = this.getProcessor(node.type)
    if (processor?.regenerate) {
      return await processor.regenerate(this, node, options)
    }
    return null
  }

  /**
   * Notify all downstream nodes that a node's content has changed.
   * This calls each downstream node's onInputContentChange method (if defined).
   */
  async notifyDownstreamNodes(changedNodeId: number): Promise<void> {
    const outgoingEdges = this.getOutgoingEdges(changedNodeId)
    for (const edge of outgoingEdges) {
      const downstreamNode = this.getNode(edge.to_node_id)
      if (!downstreamNode) continue
      const processor = this.getProcessor(downstreamNode.type)
      if (processor?.onInputContentChange) {
        await processor.onInputContentChange(this, downstreamNode, changedNodeId)
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────────

  private async updateNodeContentInDb(nodeId: number, content: string): Promise<void> {
    const wordCount = this.countWords(content)
    const charCount = this.countChars(content)
    const byteCount = this.countBytes(content)

    // @ts-ignore – we need to access the private db field from GraphManager
    const db: Database = this.db
    db.prepare(
      `UPDATE plan_nodes SET content = ?, word_count = ?, char_count = ?, byte_count = ? WHERE id = ?`
    ).run(content, wordCount, charCount, byteCount, nodeId)
  }

  private countWords(text: string): number {
    const t = text.trim()
    return t === '' ? 0 : t.split(/\s+/).length
  }

  private countChars(text: string): number {
    return [...text].length
  }

  private countBytes(text: string): number {
    return Buffer.byteLength(text, 'utf8')
  }
}