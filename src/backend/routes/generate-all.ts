import { GraphEngine } from '../lib/node-graph/engine/graph-engine.js'
import { PlanNodeService } from '../plan/nodes/plan-node-service.js'

export async function generateAll(
  params: { regenerateManual?: boolean },
  onThinking: (status: string, detail?: string) => void,
  onPartialJson: (data: Record<string, unknown>) => void,
): Promise<{ generated: number; skipped: number }> {
  const nodeService = new PlanNodeService()
  const engine = new GraphEngine(nodeService)

  const regenerateManual = params.regenerateManual ?? false

  let generated = 0
  let skipped = 0

  onThinking('start', `Starting generation of all nodes (regenerateManual: ${regenerateManual})`)

  await engine.generateAllNodes({
    regenerateManual,
    onProgress: (nodeId, status, queueSize, reason) => {
      if (status === 'processing') {
        onThinking('processing', `Processing node ${nodeId} (${queueSize} nodes left in queue)`)
      } else if (status === 'generated') {
        generated++
        onPartialJson({
          type: 'node_generated',
          nodeId,
          generated,
          skipped,
          queueSize,
          reason: reason ?? null,
        })
      } else if (status === 'skipped') {
        skipped++
        onPartialJson({
          type: 'node_skipped',
          nodeId,
          generated,
          skipped,
          queueSize,
          reason: reason ?? null,
        })
      } else if (status === 'error') {
        // Node generation failed, status already set to ERROR in graph engine
        // Emit an error event for UI
        console.log(`[generateAll] node ${nodeId} generation error, emitting node_error`)
        onPartialJson({
          type: 'node_error',
          nodeId,
          generated,
          skipped,
          queueSize,
          reason: reason ?? null,
        })
      }
    },
  })

  onThinking('done', `Generation completed: ${generated} generated, ${skipped} skipped`)
  return { generated, skipped }
}