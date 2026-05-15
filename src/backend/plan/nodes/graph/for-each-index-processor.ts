import type { PlanNodeRow, PlanNodeUpdate } from "../../../../shared/plan-graph.js"
import type { PlanNodeService } from "../plan-node-service.js"
import type { NodeProcessor } from "./node-processor.js"

/**
 * Processor for 'for-each-index' nodes.
 *
 * Emits the current iteration's 1-based position as a string. The value is
 * read live from the enclosing for-each's content (`currentIndex`), so no
 * regeneration or override-storage is needed — `getOutput` is a pure function
 * of the parent for-each's state.
 *
 * The node has no inputs and is confined to its for-each container by the
 * NodeTypeDefinition. Whichever for-each is its direct parent provides the
 * index it surfaces.
 */
export class ForEachIndexProcessor implements NodeProcessor<unknown> {
  readonly defaultSettings: unknown = {}

  getOutput(service: PlanNodeService, node: PlanNodeRow): string {
    return this.computeIndexString(service, node)
  }

  /**
   * Set summary = the iteration number too. PlanNodeService.regenerate skips
   * its LLM auto-summary call when patch.summary is already defined, so this
   * is the place to short-circuit and avoid a useless `generate-summary` call
   * on a node whose content is literally "5".
   */
  async regenerate(service: PlanNodeService, _context: unknown, node: PlanNodeRow): Promise<PlanNodeUpdate> {
    const value = this.computeIndexString(service, node)
    return {
      summary: value,
      status: value.length > 0 ? "GENERATED" : "EMPTY",
    }
  }

  private computeIndexString(service: PlanNodeService, node: PlanNodeRow): string {
    if (node.parent_id === null) return ""
    const parent = service.repo.findById(node.parent_id)
    if (!parent || parent.type !== "for-each") return ""
    try {
      const content = JSON.parse(parent.content || "{}") as { currentIndex?: unknown }
      const idx = typeof content.currentIndex === "number" ? content.currentIndex : 0
      return String(idx + 1)
    } catch {
      return "1"
    }
  }
}
