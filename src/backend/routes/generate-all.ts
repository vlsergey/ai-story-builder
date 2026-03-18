import { getCurrentDbPath } from '../db/state.js'
import { GraphEngine } from '../lib/node-graph/engine/graph-engine.js'
import { PlanNodeService } from '../plan/nodes/plan-node-service.js'

let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch (_) {
  Database = null
}

// ── Error helper ──────────────────────────────────────────────────────────────

function makeError(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}

export async function generateAll(
  params: { regenerateManual?: boolean },
  onThinking: (status: string, detail?: string) => void,
  onPartialJson: (data: Record<string, unknown>) => void,
): Promise<{ generated: number; skipped: number }> {
  const dbPath = getCurrentDbPath()
  if (!dbPath) throw makeError('no project open', 400)
  if (!Database) throw makeError('SQLite lib missing', 500)

  const db = new (Database)(dbPath)
  const nodeService = new PlanNodeService()
  const engine = new GraphEngine(db, nodeService)

  const regenerateManual = params.regenerateManual ?? false

  let generated = 0
  let skipped = 0

  onThinking('start', `Starting generation of all nodes (regenerateManual: ${regenerateManual})`)

  await engine.generateAllNodes({
    regenerateManual,
    onProgress: (nodeId, status, queueSize) => {
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
        })
      } else if (status === 'skipped') {
        skipped++
        onPartialJson({
          type: 'node_skipped',
          nodeId,
          generated,
          skipped,
          queueSize,
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
        })
      }
    },
  })

  onThinking('done', `Generation completed: ${generated} generated, ${skipped} skipped`)
  return { generated, skipped }
}