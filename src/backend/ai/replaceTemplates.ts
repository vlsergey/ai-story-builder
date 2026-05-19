import Handlebars from "handlebars"
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

/**
 * Render a prompt template against a flat map of named string variables.
 *
 * Variables come from upstream node contents (keyed by node title) plus
 * wizard-time fields the template author chose to expose. Identifiers in
 * Handlebars must be ASCII; our node titles are mostly Russian, so authors
 * write them in bracket form: `{{[Реестр сетапов и пэйоффов]}}`.
 *
 * Helpers available inside expressions:
 * - `eq` / `ne` — strict equality / inequality.
 * - `or` / `and` / `not` — boolean composition (n-ary; `not` is unary).
 * - `contains` — substring check.
 * - `startsWith` / `endsWith`.
 * - `matches` — regex test (pattern as string, optional flags).
 *
 * Examples:
 *   {{[Стиль]}}
 *   {{#if (eq ageRating "18+")}}...{{/if}}
 *   {{#if (contains [Чанк] "mode=fragment")}}...{{/if}}
 *
 * After rendering, any `{{...}}` that survived (unresolved variable, typo in
 * a name) is treated as a hard error — we don't ship half-rendered prompts to
 * the LLM. Handlebars by default renders missing top-level variables as empty
 * string, so the post-check is the only guard against silently-empty
 * placeholders.
 */
const handlebarsInstance = Handlebars.create()
handlebarsInstance.registerHelper("eq", (a: unknown, b: unknown) => a === b)
handlebarsInstance.registerHelper("ne", (a: unknown, b: unknown) => a !== b)
handlebarsInstance.registerHelper("contains", (haystack: unknown, needle: unknown) => {
  if (typeof haystack !== "string" || typeof needle !== "string") return false
  return haystack.includes(needle)
})
handlebarsInstance.registerHelper("startsWith", (haystack: unknown, prefix: unknown) => {
  if (typeof haystack !== "string" || typeof prefix !== "string") return false
  return haystack.startsWith(prefix)
})
handlebarsInstance.registerHelper("endsWith", (haystack: unknown, suffix: unknown) => {
  if (typeof haystack !== "string" || typeof suffix !== "string") return false
  return haystack.endsWith(suffix)
})
handlebarsInstance.registerHelper("or", (...args: unknown[]) => {
  // Handlebars passes its `options` object as the last arg; strip it.
  const operands = args.slice(0, -1)
  return operands.some((v) => Boolean(v))
})
handlebarsInstance.registerHelper("and", (...args: unknown[]) => {
  const operands = args.slice(0, -1)
  return operands.every((v) => Boolean(v))
})
handlebarsInstance.registerHelper("not", (a: unknown) => !a)
handlebarsInstance.registerHelper("matches", (input: unknown, pattern: unknown, flags?: unknown) => {
  if (typeof input !== "string" || typeof pattern !== "string") return false
  try {
    const re = new RegExp(pattern, typeof flags === "string" ? flags : "")
    return re.test(input)
  } catch {
    return false
  }
})

// Math helpers — minimal set, expand as templates need more. After
// apply-time `${var}` substitution leaves literal numbers in the prompt,
// these helpers do the actual arithmetic at LLM-call time.
// Subexpression form (Handlebars-native prefix):
//   {{max 3 (ceil (divide 20 2))}}  ⟹  10
function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) throw new Error(`expected number, got: ${JSON.stringify(v)}`)
  return n
}
handlebarsInstance.registerHelper("add", (a: unknown, b: unknown) => toNum(a) + toNum(b))
handlebarsInstance.registerHelper("subtract", (a: unknown, b: unknown) => toNum(a) - toNum(b))
handlebarsInstance.registerHelper("multiply", (a: unknown, b: unknown) => toNum(a) * toNum(b))
handlebarsInstance.registerHelper("divide", (a: unknown, b: unknown) => toNum(a) / toNum(b))
handlebarsInstance.registerHelper("ceil", (a: unknown) => Math.ceil(toNum(a)))
handlebarsInstance.registerHelper("floor", (a: unknown) => Math.floor(toNum(a)))
handlebarsInstance.registerHelper("round", (a: unknown) => Math.round(toNum(a)))
handlebarsInstance.registerHelper("abs", (a: unknown) => Math.abs(toNum(a)))
handlebarsInstance.registerHelper("min", (...args: unknown[]) => Math.min(...args.slice(0, -1).map(toNum)))
handlebarsInstance.registerHelper("max", (...args: unknown[]) => Math.max(...args.slice(0, -1).map(toNum)))

export function replaceTemplates<T extends string | null>(
  content: string | null,
  replacements: Record<string, string>,
): T {
  if (!content) return content as T

  let rendered: string
  try {
    const compiled = handlebarsInstance.compile(content.trim(), {
      noEscape: true,
      strict: true,
      preventIndent: false,
    })
    rendered = compiled(replacements)
  } catch (err) {
    throw makeErrorWithStatus(`Template render failed: ${(err as Error).message}`, 400)
  }

  const remainingPlaceholders = rendered.match(/\{\{[^}]+?\}\}/g)
  if (remainingPlaceholders && remainingPlaceholders.length > 0) {
    throw makeErrorWithStatus(
      `Unable to resolve template: ${remainingPlaceholders.join(", ")}. Make sure that specified nodes exist.`,
      400,
    )
  }

  return rendered as T
}
