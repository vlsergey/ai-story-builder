import { createHash } from "node:crypto"
import type { ParallelSettings } from "../../../../shared/node-settings.js"
import { expandParallel, parseParallelContent } from "../../../../shared/parallel-plan-node.js"
import type { PlanNodeRow, PlanNodeStateUpdate } from "../../../../shared/plan-graph.js"
import { childPath } from "../../../../shared/plan-node-path.js"
import { maxConcurrentCalls } from "../../../ai/engine-slots.js"
import { withDbTransaction } from "../../../db/connection.js"
import { SettingsRepository } from "../../../settings/settings-repository.js"
import type { RegenerationNodeContext } from "../generate/RegenerationContext.js"
import { regenerateSubtreeNodesContents } from "../generate/regenerateTreeNodesContents.js"
import type { PlanNodeService } from "../plan-node-service.js"
import { loopChild, loopElements } from "./loop-input.js"
import type { NodeProcessor } from "./node-processor.js"

const sha256 = (element: string) => createHash("sha256").update(element, "utf8").digest("hex")

/**
 * A loop whose iterations run side by side. An iteration is keyed by the
 * element it works on (`<loop path>/<loop id>:<hash prefix>`), so identical
 * elements run once, and an element inserted or removed upstream leaves the
 * others' results alone. No iteration can read another: there is no order to
 * read them in.
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
    context: RegenerationNodeContext,
    row: PlanNodeRow,
    settings: ParallelSettings,
  ): Promise<PlanNodeStateUpdate | null> {
    const elements = loopElements(service, row)
    const input = loopChild(service, row.id, "for-each-input")
    const expansion = expandParallel(parseParallelContent(row.content), elements, sha256)

    // The iterations are recorded before they run, as a for-each does.
    const content = JSON.stringify(expansion.content)
    if (!(await service.writeWhileRunning(row, { content }))) return null
    // Keys that grew carry their iterations' rows along; iterations whose
    // element is gone go, with everything nested in them.
    withDbTransaction(() => {
      for (const { from, to } of expansion.renamed) service.states.renameIteration(row.id, row.path, from, to)
      service.states.deleteIterationsWhere(row.id, row.path, (key) => !expansion.elements.has(key))
    })

    // A key names its element for good: only a new iteration gets its input.
    for (const [key, element] of expansion.elements) {
      const path = childPath(row.path, row.id, key)
      if (service.states.find(input.id, path)?.content !== element) {
        await service.patchState(input.id, path, false, { content: element, status: "OUTDATED" })
      }
    }

    const keys = [...expansion.elements.keys()]
    const engine = SettingsRepository.getCurrentBackend()
    const concurrency = settings.concurrency ?? (engine ? maxConcurrentCalls(engine) : 1)
    console.log(
      `[ParallelProcessor] node ${row.id} at "${row.path}": ${keys.length} iteration(s), ${concurrency} at once`,
    )
    await context.asCycle(keys.length, (cycle) =>
      cycle.asContainers(keys, concurrency, (childContext) => regenerateSubtreeNodesContents(childContext, row.id)),
    )

    // A loop's text is its iterations' outputs: they have their own summaries.
    return { content, summary: row.summary }
  }
}
