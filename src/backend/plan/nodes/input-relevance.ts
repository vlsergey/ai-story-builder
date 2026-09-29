import Handlebars from "handlebars"
import type { FixProblemsPlanNodeSettings } from "../../../shared/fix-problems-plan-node.js"
import type { PlanNodeDefinition } from "../../../shared/plan-graph.js"
import { getNodePrompts } from "./graph/settings-helper.js"

/**
 * Top-level variable names a Handlebars template reads: `{{X}}`, `{{[Title with spaces]}}`,
 * helper arguments such as `(contains [X] "a")`, `{{#each [X]}}`, `{{../[X]}}`,
 * `{{@root.[X]}}` and `{{lookup . "X"}}`.
 * Helper names come along too — harmless, no node is titled `if`.
 * Returns `null` when the template does not parse: the caller must then assume
 * it reads everything.
 */
export function templateVariables(template: string): Set<string> | null {
  let program: unknown
  try {
    program = Handlebars.parse(template)
  } catch {
    return null
  }
  const names = new Set<string>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    const record = node as Record<string, unknown>
    if (record.type === "PathExpression") {
      const parts = record.parts as string[]
      if (!record.data && parts.length > 0) names.add(parts[0])
      // `{{@root.[Title]}}` reaches the top-level context from inside a block.
      if (record.data && parts[0] === "root" && parts.length > 1) names.add(parts[1])
      return
    }
    // `{{lookup . "Title"}}` names the input in a string.
    const path = record.path as { original?: unknown } | undefined
    if (path?.original === "lookup") {
      for (const param of (record.params as { type?: string; value?: unknown }[] | undefined) ?? []) {
        if (param.type === "StringLiteral" && typeof param.value === "string") names.add(param.value)
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (key !== "loc") visit(value)
    }
  }
  visit(program)
  return names
}

/**
 * The templates through which a node reads its inputs, or `null` when it reads
 * every input by construction (merge, format, script, containers and their
 * internal nodes).
 */
function inputTemplates(node: Pick<PlanNodeDefinition, "type" | "node_type_settings">): string[] | null {
  switch (node.type) {
    case "text":
    case "split": {
      const { userPrompt, systemPrompt } = getNodePrompts(node.node_type_settings)
      return [userPrompt, systemPrompt].filter((t): t is string => !!t)
    }
    case "fix-problems": {
      const settings = parseSettings<FixProblemsPlanNodeSettings>(node)
      return [
        settings.aiUserInstructionsToFindProblems,
        settings.aiSystemInstructionsToFindProblems,
        settings.aiUserInstructionsToFixProblems,
        settings.aiSystemInstructionsToFixProblems,
      ].filter((t): t is string => !!t)
    }
    default:
      return null
  }
}

function parseSettings<T>(node: Pick<PlanNodeDefinition, "node_type_settings">): Partial<T> {
  try {
    return (JSON.parse(node.node_type_settings ?? "{}") ?? {}) as Partial<T>
  } catch {
    return {}
  }
}

/**
 * Whether a change of `source` can change what `consumer` produces. A text or
 * split node reads an input only if one of its prompts names it; fix-problems
 * also reads the text it fixes. Everything else reads all its inputs.
 */
export function usesInput(
  consumer: Pick<PlanNodeDefinition, "type" | "node_type_settings">,
  source: Pick<PlanNodeDefinition, "id" | "title">,
): boolean {
  if (consumer.type === "fix-problems") {
    const { sourceNodeIdToFix } = parseSettings<FixProblemsPlanNodeSettings>(consumer)
    // Without an explicit choice the only input is the one being fixed.
    if (sourceNodeIdToFix === undefined || sourceNodeIdToFix === null || sourceNodeIdToFix === source.id) return true
  }
  const templates = inputTemplates(consumer)
  if (templates === null) return true
  return templates.some((template) => {
    const variables = templateVariables(template)
    return variables === null || variables.has(source.title)
  })
}
