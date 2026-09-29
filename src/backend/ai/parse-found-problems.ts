import type { FindProblemsResult } from "../../shared/fix-problems-plan-node.js"

/** How much of a bad answer goes into the error message. */
const SNIPPET_LIMIT = 600

/**
 * Parse a find-problems answer, keeping the answer itself when it fails.
 *
 * A bare `JSON.parse` reports a character position and throws the text away,
 * which is the one thing worth having: a model can return a refusal, an empty
 * string, or — seen in the wild — a complete object followed by prose it went
 * on to write anyway. All three look the same in `SyntaxError: Unexpected …
 * at position 21`, and reproducing the call is the only way to find out which.
 * Since these answers are not deterministic, by then the evidence is gone.
 */
export function parseFoundProblems(raw: string, nodeTitle: string): FindProblemsResult {
  if (raw.trim().length === 0) {
    throw new Error(`${nodeTitle}: the model returned an empty answer where a findings object was expected.`)
  }
  try {
    return JSON.parse(raw) as FindProblemsResult
  } catch (err) {
    const snippet = raw.length > SNIPPET_LIMIT ? `${raw.slice(0, SNIPPET_LIMIT)}…` : raw
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`${nodeTitle}: the findings answer is not valid JSON (${reason}). Answer was:\n${snippet}`)
  }
}
