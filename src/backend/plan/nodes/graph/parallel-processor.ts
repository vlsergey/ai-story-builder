import { createHash } from "node:crypto"
import type { ParallelSettings } from "../../../../shared/node-settings.js"
import { expandParallel, parseParallelContent } from "../../../../shared/parallel-plan-node.js"
import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import { childPath } from "../../../../shared/plan-node-path.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import type { PlanNodeService } from "../plan-node-service.js"
import { loopChild, loopElements } from "./loop-input.js"
import type { NodeProcessor } from "./node-processor.js"

/** The full hash an element's iteration key is a prefix of. */
export const elementHash = (element: string) => createHash("sha256").update(element, "utf8").digest("hex")

/**
 * A loop whose iterations are keyed by the element they work on
 * (`<loop path>/<loop id>:<hash prefix>`), so identical elements run once, and
 * an element inserted or removed upstream leaves the others' results alone.
 * No iteration can read another: there is no order to read them in, and all
 * of them run side by side.
 */
export class ParallelProcessor implements NodeProcessor<ParallelSettings> {
  readonly defaultSettings: ParallelSettings = {}

  /** One output per element, in list order; identical elements hand on the same one. */
  getOutput(service: PlanNodeService, row: PlanNodeRow): string[] {
    const { order } = parseParallelContent(row.content)
    if (order.length === 0) return []
    const output = loopChild(service, row.id, "for-each-output")
    return order.map((key) => service.states.find(output.id, childPath(row.path, row.id, key))?.content ?? "")
  }

  async regenerate(
    service: PlanNodeService,
    _context: RegenerationNodeContext,
    row: PlanNodeRow,
    _settings: ParallelSettings,
  ): Promise<PlanNodeStateUpdate | null> {
    const elements = loopElements(service, row)
    const input = loopChild(service, row.id, "for-each-input")
    const expansion = expandParallel(parseParallelContent(row.content), elements, elementHash)

    // The iterations are recorded before they run, as a for-each does. Keys
    // that grew carry their iterations' rows along, and iterations whose
    // element is gone go, with everything nested in them — in the same
    // transaction: a run dying half-way cannot leave the record ahead of the
    // rows, or the next run would take grown keys for new ones.
    const content = JSON.stringify(expansion.content)
    const moved = await service.writeWhileRunning(row, { content }, () => {
      for (const { from, to } of expansion.renamed) service.states.renameIteration(row.id, row.path, from, to)
      service.states.deleteIterationsWhere(row.id, row.path, (key) => !expansion.elements.has(key))
    })
    if (!moved) return null

    // A key names its element for good: only a new iteration gets its input.
    for (const [key, element] of expansion.elements) {
      const path = childPath(row.path, row.id, key)
      if (service.states.find(input.id, path)?.content !== element) {
        await service.patchState(input.id, path, false, { content: element, status: "OUTDATED" })
      }
    }

    console.log(`[ParallelProcessor] node ${row.id} at "${row.path}": ${expansion.elements.size} iteration(s)`)

    // A loop's text is its iterations' outputs: they have their own summaries.
    return { content, summary: row.summary }
  }
}
