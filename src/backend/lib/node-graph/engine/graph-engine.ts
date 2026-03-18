import { NodeProcessorRegistry } from './node-processor.js'
import { TextProcessor } from './text-processor.js'
import { LoreProcessor } from './lore-processor.js'
import { SplitProcessor } from './split-processor.js'
import { MergeProcessor } from './merge-processor.js'
import type { PlanNodeType, PlanEdgeType, PlanNodeStatus } from '../../../../shared/plan-graph'
import type { NodeData, NodeContext } from '../node-interfaces.js'
import type { AiSettings } from '../../../../shared/ai-settings.js'
import { mergeNodeSettings } from './settings-helper.js'
import { generateSummary } from '../../../routes/generate-summary.js'
import { PlanNodeService } from '../../../plan/nodes/plan-node-service.js'
import { PlanEdgeRepository } from '../../../plan/edges/plan-edge-repository.js'
import { SettingsRepository } from '../../../settings/settings-repository.js'

/**
 * Graph engine that provides database access, node processing, and advanced operations.
 * Implements NodeContext directly, merging the former GraphManager functionality.
 */
export class GraphEngine implements NodeContext {
  private processorRegistry: NodeProcessorRegistry
  private nodeService: PlanNodeService

  constructor(nodeService?: PlanNodeService) {
    this.processorRegistry = new NodeProcessorRegistry()
    this.nodeService = nodeService ?? new PlanNodeService()
    this.registerDefaultProcessors()
  }

  private registerDefaultProcessors() {
    this.processorRegistry.register(new TextProcessor())
    this.processorRegistry.register(new LoreProcessor())
    this.processorRegistry.register(new SplitProcessor())
    this.processorRegistry.register(new MergeProcessor())
  }

  /**
   * Get a node by ID using the node service.
   */
  getNode(id: number): NodeData | undefined {
    const row = this.nodeService.getById(id)
    if (!row) return undefined
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      user_prompt: row.user_prompt,
      system_prompt: row.system_prompt,
      node_type_settings: row.node_type_settings,
      status: row.status,
    }
  }

  /**
   * Get incoming edges for a node.
   */
  getIncomingEdges(nodeId: number): Array<{ from_node_id: number; type: PlanEdgeType }> {
    const edgeRepo = new PlanEdgeRepository()
    const edges = edgeRepo.getByToNodeId(nodeId)
    return edges.map(edge => ({ from_node_id: edge.from_node_id, type: edge.type }))
  }

  /**
   * Get outgoing edges for a node.
   */
  getOutgoingEdges(nodeId: number): Array<{ to_node_id: number; type: PlanEdgeType }> {
    const edgeRepo = new PlanEdgeRepository()
    const edges = edgeRepo.getByFromNodeId(nodeId)
    return edges.map(edge => ({ to_node_id: edge.to_node_id, type: edge.type }))
  }

  /**
   * Retrieve AI settings from the project (model, webSearch, etc.).
   */
  getAiSettings(): AiSettings {
    const engine = SettingsRepository.get('current_backend')
    const config = SettingsRepository.getAiConfig()
    if (!engine || !config) return {}

    const engineConfig = config[engine] as Record<string, any> | undefined
    if (!engineConfig) return {}
    // Map known keys to AiSettings
    const settings: AiSettings = {}
    if (typeof engineConfig.model === 'string') {
      settings.model = engineConfig.model
    }
    if (typeof engineConfig.web_search === 'string') {
      settings.webSearch = engineConfig.web_search
    }
    if (typeof engineConfig.include_existing_lore === 'boolean') {
      settings.includeExistingLore = engineConfig.include_existing_lore
    }
    if (typeof engineConfig.max_tokens === 'number') {
      settings.maxTokens = engineConfig.max_tokens
    }
    if (typeof engineConfig.max_completion_tokens === 'number') {
      settings.maxCompletionTokens = engineConfig.max_completion_tokens
    }
    console.log("AI Settings: " + JSON.stringify(engineConfig))
    return settings
  }

  /**
   * Get the processor for a given node type.
   */
  getProcessor(nodeType: PlanNodeType) {
    return this.processorRegistry.getProcessor(nodeType)
  }

  /**
   * Get merged settings for a node (defaults + node_type_settings).
   * Returns unknown because the concrete type depends on node type.
   */
  private getNodeSettings(node: NodeData): unknown {
    const processor = this.getProcessor(node.type)
    if (!processor) {
      // No processor, return empty object
      return {}
    }
    // processor.defaultSettings is of type unknown, but we know it's a Record<string, any>
    return mergeNodeSettings(processor.defaultSettings as Record<string, any>, node.node_type_settings)
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
   * Retrieve all nodes in the graph.
   */
  private getAllNodes(): NodeData[] {
    const rows = this.nodeService.getAll()
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      user_prompt: row.user_prompt,
      system_prompt: row.system_prompt,
      node_type_settings: row.node_type_settings,
      status: row.status,
    }))
  }

  /**
   * Update node content and trigger any downstream updates (e.g., auto‑update merge nodes).
   */
  async updateNodeContent(nodeId: number, newContent: string | null, newStatus?: string): Promise<void> {
    const node = this.getNode(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    const oldContent = node.content

    console.log(`[GraphEngine] updateNodeContent node ${nodeId}, newStatus=${newStatus ?? '(none)'}`)
    // Update in database
    await this.updateNodeContentInDb(nodeId, newContent, newStatus)

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
  async regenerateNode(nodeId: number): Promise<string | null> {
    const node = this.getNode(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    const processor = this.getProcessor(node.type)
    if (processor?.regenerate) {
      const settings = this.getNodeSettings(node)
      return await processor.regenerate(this, node, settings)
    }
    return null
  }

  /**
   * Check if auto‑generate‑summary setting is enabled for the current project.
   */
  private getAutoGenerateSummarySetting(): boolean {
    const value = SettingsRepository.get('auto_generate_summary')
    return value === 'true'
  }

  /**
   * Generate a summary for a node if the project setting allows it.
   * This is a fire‑and‑forget operation; errors are logged but not propagated.
   */
  private async maybeGenerateSummary(nodeId: number, content: string): Promise<void> {
    if (!this.getAutoGenerateSummarySetting()) {
      return
    }
    try {
      await generateSummary({ node_id: nodeId, content })
    } catch (error) {
      console.error(`[GraphEngine] Failed to generate summary for node ${nodeId}:`, error)
    }
  }

  /**
   * Generate content for all nodes in topological order, respecting dependencies.
   * @param options.regenerateManual If true, MANUAL nodes will be regenerated; otherwise they are skipped.
   * @param options.onProgress Optional callback to report progress (nodeId, status, queueSize).
   */
  async generateAllNodes(options?: {
    regenerateManual?: boolean
    onProgress?: (nodeId: number, status: 'pending' | 'processing' | 'generated' | 'skipped' | 'error', queueSize: number) => void
  }): Promise<void> {
    const regenerateManual = options?.regenerateManual ?? false
    const onProgress = options?.onProgress

    // Get all nodes and build adjacency
    const nodes = this.getAllNodes()
    const nodeIds = nodes.map(n => n.id)
    const incomingEdges = new Map<number, number[]>()
    const outgoingEdges = new Map<number, number[]>()

    for (const nodeId of nodeIds) {
      incomingEdges.set(nodeId, [])
      outgoingEdges.set(nodeId, [])
    }

    // Fill adjacency from edges
    const edgeRows = new PlanEdgeRepository().getAll()
    for (const edge of edgeRows) {
      incomingEdges.get(edge.to_node_id)!.push(edge.from_node_id)
      outgoingEdges.get(edge.from_node_id)!.push(edge.to_node_id)
    }

    // Set of nodes that have been checked (processed)
    const checked = new Set<number>()
    // Queue of nodes to check (initialized with nodes that have no incoming edges)
    const queue: number[] = nodeIds.filter(id => incomingEdges.get(id)!.length === 0)
    // Map from node id to its data
    const nodeMap = new Map<number, NodeData>()
    for (const node of nodes) {
      nodeMap.set(node.id, node)
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      const node = nodeMap.get(nodeId)!
      console.log(`[GraphEngine] processing node ${nodeId} (${node.type}) status=${node.status}, queue size=${queue.length}`)
      if (onProgress) onProgress(nodeId, 'processing', queue.length)

      // Check if all sources are already checked
      const sources = incomingEdges.get(nodeId)!
      const allSourcesChecked = sources.every(srcId => checked.has(srcId))
      if (!allSourcesChecked) {
        // Not ready yet, put back at the end of queue (will be revisited later)
        console.log(`[GraphEngine] node ${nodeId} not ready, missing sources: ${sources.filter(srcId => !checked.has(srcId)).join(',')}`)
        queue.push(nodeId)
        continue
      }

      // Determine if we should regenerate this node
      let shouldRegenerate = false
      if (node.status === 'ERROR' || node.status === 'EMPTY' || node.status === 'OUTDATED') {
        shouldRegenerate = true
      } else if (node.status === 'MANUAL' && regenerateManual) {
        shouldRegenerate = true
      }
      console.log(`[GraphEngine] shouldRegenerate=${shouldRegenerate} (regenerateManual=${regenerateManual})`)

      if (shouldRegenerate) {
        // Generate content using the node's processor
        const processor = this.getProcessor(node.type)
        if (processor?.regenerate) {
          console.log(`[GraphEngine] calling regenerate for node ${nodeId}`)
          const settings = this.getNodeSettings(node)
          try {
            const newContent = await processor.regenerate(this, node, settings)
            console.log(`[GraphEngine] regenerate returned content length=${newContent?.length ?? 'null'}`)
            if (newContent !== null) {
              await this.updateNodeContent(nodeId, newContent, 'GENERATED')
              // Generate summary if project setting allows
              await this.maybeGenerateSummary(nodeId, newContent)
              // Update node data after content change (status may have changed)
              const updatedNode = this.getNode(nodeId)
              if (updatedNode) nodeMap.set(nodeId, updatedNode)
              if (onProgress) onProgress(nodeId, 'generated', queue.length)
            } else {
              // No content generated (e.g., no prompt) – treat as skipped
              console.log(`[GraphEngine] no content generated for node ${nodeId}, skipping`)
              if (onProgress) onProgress(nodeId, 'skipped', queue.length)
            }
          } catch (error) {
            console.error(`[GraphEngine] regeneration failed for node ${nodeId}:`, error)
            // Set status to ERROR, keep existing content
            console.log(`[GraphEngine] setting node ${nodeId} status to ERROR`)
            await this.updateNodeContent(nodeId, node.content, 'ERROR')
            const updatedNode = this.getNode(nodeId)
            if (updatedNode) nodeMap.set(nodeId, updatedNode)
            console.log(`[GraphEngine] node ${nodeId} status updated to ERROR`)
            if (onProgress) onProgress(nodeId, 'error', queue.length)
          }
        } else {
          console.log(`[GraphEngine] no processor or regenerate method for node ${nodeId}`)
          // Cannot regenerate, treat as skipped
          if (onProgress) onProgress(nodeId, 'skipped', queue.length)
        }
      } else {
        console.log(`[GraphEngine] skipping node ${nodeId}`)
        if (onProgress) onProgress(nodeId, 'skipped', queue.length)
      }

      // Mark as checked
      checked.add(nodeId)

      // Add outgoing nodes to queue if not already in queue and not checked
      const outgoing = outgoingEdges.get(nodeId)!
      for (const outId of outgoing) {
        if (!checked.has(outId) && !queue.includes(outId)) {
          queue.push(outId)
        }
      }
    }
  }

  /**
   * Notify all downstream nodes that a node's content has changed.
   * This calls each downstream node's onInputContentChange method (if defined).
   * If the processor returns updated NodeData, the node will be updated (if content changed)
   * and downstream notifications will propagate further.
   */
  async notifyDownstreamNodes(changedNodeId: number): Promise<void> {
    const outgoingEdges = this.getOutgoingEdges(changedNodeId)
    for (const edge of outgoingEdges) {
      const downstreamNode = this.getNode(edge.to_node_id)
      if (!downstreamNode) continue
      const processor = this.getProcessor(downstreamNode.type)
      if (processor?.onInputContentChange) {
        const settings = this.getNodeSettings(downstreamNode)
        const updatedNodeData = await processor.onInputContentChange(this, downstreamNode, changedNodeId, settings)
        if (updatedNodeData && updatedNodeData.content !== downstreamNode.content) {
          // Update the node with new content (other fields are ignored for now)
          await this.updateNodeContent(downstreamNode.id, updatedNodeData.content)
        }
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────────

  private async updateNodeContentInDb(nodeId: number, content: string | null, newStatus?: string): Promise<void> {
    console.log(`[GraphEngine] updating node ${nodeId} content length=${content?.length ?? 'null'}, status=${newStatus ?? '(unchanged)'}`)
    this.nodeService.updateContent(nodeId, content, {
      status: newStatus as PlanNodeStatus | undefined,
    })
  }

}