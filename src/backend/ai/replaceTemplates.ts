import { makeErrorWithStatus } from "../lib/make-errors.js"
import type { NodeInputs } from "../plan/nodes/NodeInput.js"

export function nodeInputsToReplacements(inputs: NodeInputs<string>): Record<string, string> {
  return inputs.reduce(
    (acc, input) => {
      acc[input.sourceNode.title] = input.input
      return acc
    },
    {} as Record<string, string>,
  )
}

export function replaceTemplates<T extends string | null>(
  content: string | null,
  replacements: Record<string, string>,
): T {
  if (!content) return content as T

  let result = (content || "").trim()
  for (const input of Object.entries(replacements)) {
    const placeholder = `{{${input[0]}}}`
    const content = input[1]
    result = result.split(placeholder).join(content)
  }

  // Check that after replacement there are no unresolved patterns left
  const remainingPlaceholders = result.match(/\{\{[^}]+?\}\}/g)
  if (remainingPlaceholders && remainingPlaceholders.length > 0) {
    throw makeErrorWithStatus(
      `Unable to resolve template: ${remainingPlaceholders.join(", ")}. Make sure that specified nodes exist.`,
      400,
    )
  }

  return result as T
}
