import type { PlanNodeRow } from "../../../../shared/plan-graph.js"

/**
 * Whether the scheduler can regenerate the node at all. LLM-calling node types
 * need a non-blank userPrompt to have anything to generate from. A text node
 * populated from a wizard substitution (e.g. the "Synopsis" node in
 * fiction-arc.ru.json) has content but no prompt — it's the SOURCE of
 * generation, not a target. Such a node is skipped by the scheduler, and so is
 * never pending work for propagation either.
 */
export function hasRegenerationCriteria(node: PlanNodeRow): boolean {
  if (node.type === "text" || node.type === "split" || node.type === "lore") {
    let userPrompt: unknown = null
    if (node.node_type_settings) {
      try {
        userPrompt = (JSON.parse(node.node_type_settings) as { userPrompt?: unknown }).userPrompt
      } catch {
        // ignore — treat as no prompt
      }
    }
    if (typeof userPrompt !== "string" || userPrompt.trim().length === 0) return false
  }
  return true
}
