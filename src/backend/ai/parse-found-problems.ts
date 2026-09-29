import type { FindProblemsResult } from "../../shared/fix-problems-plan-node.js"

/** How much of a bad answer goes into the error message. */
const SNIPPET_LIMIT = 600

/**
 * Split a string into the top-level JSON values it contains, in order.
 *
 * Normally there is exactly one and this returns it unchanged. It exists for
 * the case where a provider glues several together with no delimiter, which is
 * not valid JSON as a whole and which `JSON.parse` rejects at the character
 * where the second value begins.
 *
 * Tracks string literals and escapes, so braces and brackets inside a
 * description do not throw the scan off. A trailing incomplete value is
 * returned as its own span — the caller decides what to do with it.
 */
export function splitTopLevelJsonValues(raw: string): string[] {
  const spans: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === "{" || ch === "[") {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === "}" || ch === "]") {
      depth--
      if (depth === 0 && start >= 0) {
        spans.push(raw.slice(start, i + 1))
        start = -1
      }
    }
  }

  // Unclosed tail (truncated answer) — hand it back so the error quotes it.
  if (depth > 0 && start >= 0) spans.push(raw.slice(start))
  if (spans.length === 0) spans.push(raw)
  return spans
}

/**
 * Parse a find-problems answer, keeping the answer itself when it fails.
 *
 * Two things go wrong in practice and neither is visible from a bare
 * `JSON.parse`, which reports a character position and throws the text away:
 *
 * 1. The answer is not JSON at all — a refusal, or an empty string.
 * 2. The answer is the same JSON value repeated, or an empty findings object
 *    followed by the real one, concatenated with no delimiter. Measured on
 *    grok-4.7 with `web_search` enabled: `output_chars` of 21, 42 and 63 for a
 *    21-character object. Both copies arrive inside a single output item, so
 *    keeping output items apart does not help.
 *
 * For (2) the last value wins. It has to be the last, not the first: the
 * observed bad shape is an empty answer followed by the real findings, and
 * taking the first would silently drop every finding — a worse failure than
 * the crash, because the run would continue and the gate would report that it
 * found nothing.
 */
export function parseFoundProblems(raw: string, nodeTitle: string): FindProblemsResult {
  if (raw.trim().length === 0) {
    throw new Error(`${nodeTitle}: the model returned an empty answer where a findings object was expected.`)
  }

  try {
    return JSON.parse(raw) as FindProblemsResult
  } catch (firstError) {
    const spans = splitTopLevelJsonValues(raw)
    if (spans.length > 1) {
      for (let i = spans.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(spans[i]) as FindProblemsResult
          console.warn(
            `[${nodeTitle}] the answer carried ${spans.length} concatenated JSON values; taking the last one ` +
              `(${spans[i].length} of ${raw.length} chars).`,
          )
          return parsed
        } catch {
          // try the one before it
        }
      }
    }
    const snippet = raw.length > SNIPPET_LIMIT ? `${raw.slice(0, SNIPPET_LIMIT)}…` : raw
    const reason = firstError instanceof Error ? firstError.message : String(firstError)
    throw new Error(`${nodeTitle}: the findings answer is not valid JSON (${reason}). Answer was:\n${snippet}`)
  }
}
