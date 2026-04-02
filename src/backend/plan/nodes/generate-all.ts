import type { PlanNodeRow } from '../../../shared/plan-graph.js'
import { generateSummary } from '../../routes/generate-summary.js'
import { SettingsRepository } from '../../settings/settings-repository.js'
import { PlanEdgeRepository } from '../edges/plan-edge-repository.js'
import { PlanNodeService } from './plan-node-service.js'

/**
 * Generate content for all nodes in topological order, respecting dependencies.
 * @param options.regenerateManual If true, MANUAL nodes will be regenerated; otherwise they are skipped.
 * @param options.onProgress Optional callback to report progress (nodeId, status, queueSize, reason?).
 * @param options.parentId If provided, only nodes with this parent_id (or null for root) are processed; recursively processes child subgraphs.
 */
export async function generateAllNodes(options?: {
  regenerateManual?: boolean
  onProgress?: (nodeId: number, status: 'pending' | 'processing' | 'generated' | 'skipped' | 'error', queueSize: number, reason?: string) => void
  parentId?: number | null
}): Promise<void> {
  const planEdgeRepository = new PlanEdgeRepository()
  const planNodeService = new PlanNodeService()

  const regenerateManual = options?.regenerateManual ?? false
  const regenerateSummary = SettingsRepository.getAutoGenerateSummary()
  const onProgress = options?.onProgress

  const parentId = options?.parentId ?? null

  // Get nodes with specific parent_id
  const nodes = planNodeService.getByParentId(parentId)
  const nodeIds = nodes.map(n => n.id)
  const incomingEdges = new Map<number, number[]>()
  const outgoingEdges = new Map<number, number[]>()

  for (const nodeId of nodeIds) {
    incomingEdges.set(nodeId, [])
    outgoingEdges.set(nodeId, [])
  }

  // Fill adjacency from edges, but only edges where both nodes are in our node set
  const edgeRows = planEdgeRepository.findAll()
  for (const edge of edgeRows) {
    if (nodeIds.includes(edge.from_node_id) && nodeIds.includes(edge.to_node_id)) {
      incomingEdges.get(edge.to_node_id)!.push(edge.from_node_id)
      outgoingEdges.get(edge.from_node_id)!.push(edge.to_node_id)
    }
  }

  // Set of nodes that have been checked (processed)
  const checked = new Set<number>()
  // Queue of nodes to check (initialized with nodes that have no incoming edges)
  const queue: number[] = nodeIds.filter(id => incomingEdges.get(id)!.length === 0)
  // Map from node id to its data
  const nodeMap = new Map<number, PlanNodeRow>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    const node = nodeMap.get(nodeId)!
    console.log(`[PlanNodeService] processing node ${nodeId} (${node.type}) status=${node.status}, queue size=${queue.length}`)
    if (onProgress) onProgress(nodeId, 'processing', queue.length)

    // Check if all sources are already checked
    const sources = incomingEdges.get(nodeId)!
    const allSourcesChecked = sources.every(srcId => checked.has(srcId))
    if (!allSourcesChecked) {
      // Not ready yet, put back at the end of queue (will be revisited later)
      console.log(`[PlanNodeService] node ${nodeId} not ready, missing sources: ${sources.filter(srcId => !checked.has(srcId)).join(',')}`)
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
    console.log(`[PlanNodeService] shouldRegenerate=${shouldRegenerate} (regenerateManual=${regenerateManual})`)

    if (shouldRegenerate) {
      // Generate content using the node's processor
      const processor = planNodeService.getProcessor(node.type)
      if (processor?.regenerate) {
        console.log(`[PlanNodeService] calling regenerate for node ${nodeId}`)
        const settings = planNodeService.getNodeSettings(node)
        try {
          const patch = await processor.regenerate(planNodeService, node, settings)
          console.log(`[PlanNodeService] regenerate returned content length=${patch?.content?.length ?? 'null'}`)

          if (patch && regenerateSummary && patch.content !== node.content) {
            try {
              patch.summary = await generateSummary(patch.content || '')
            } catch (error) {
              console.error(`[PlanNodeService] summary generation failed for node ${nodeId}:`, error)
            }
          }

          if (patch) {
            const updatedNode = await planNodeService.patch(nodeId, false, patch)
            // Update node data after content change (status may have changed)
            nodeMap.set(nodeId, updatedNode)
          }
          if (onProgress) onProgress(nodeId, 'generated', queue.length)
        } catch (error) {
          console.error(`[PlanNodeService] regeneration failed for node ${nodeId}:`, error)
          // Set status to ERROR, keep existing content
          console.log(`[PlanNodeService] setting node ${nodeId} status to ERROR`)
          await planNodeService.patch(nodeId, false, {status: 'ERROR'})
          const updatedNode = planNodeService.getById(nodeId)
          if (updatedNode) nodeMap.set(nodeId, updatedNode)
          console.log(`[PlanNodeService] node ${nodeId} status updated to ERROR`)
          const reason = error instanceof Error ? error.message : String(error)
          if (onProgress) onProgress(nodeId, 'error', queue.length, `regeneration failed: ${reason}`)
        }
      } else {
        console.log(`[PlanNodeService] no processor or regenerate method for node ${nodeId}`)
        // Cannot regenerate, treat as skipped
        if (onProgress) onProgress(nodeId, 'skipped', queue.length, 'no processor or regenerate method')
      }
    } else {
      console.log(`[PlanNodeService] skipping node ${nodeId}`)
      // Determine skip reason based on node status and regenerateManual
      let skipReason = ''
      if (node.status === 'MANUAL' && !regenerateManual) {
        skipReason = 'MANUAL node (regenerateManual is false)'
      } else if (node.status === 'GENERATED') {
        skipReason = 'already GENERATED'
      } else {
        skipReason = `status ${node.status} (no regeneration condition met)`
      }
      if (onProgress) onProgress(nodeId, 'skipped', queue.length, skipReason)
    }

    // Mark as checked
    checked.add(nodeId)

    // If this is a for-each node, recursively generate its child subgraph
    if (node.type === 'for-each') {
      await generateAllNodes({ ...options, parentId: node.id })
    }

    // Add outgoing nodes to queue if not already in queue and not checked
    const outgoing = outgoingEdges.get(nodeId)!
    for (const outId of outgoing) {
      if (!checked.has(outId) && !queue.includes(outId)) {
        queue.push(outId)
      }
    }
  }
}
