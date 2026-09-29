import { describe, expect, it, vi } from "vitest"
import { parseFoundProblems, splitTopLevelJsonValues } from "./parse-found-problems.js"

const EMPTY = '{"foundProblems": []}'
const ONE = '{"foundProblems":[{"severity":80,"description":"d","fixProposal":"f"}]}'

describe("splitTopLevelJsonValues", () => {
  it("returns a lone value unchanged", () => {
    expect(splitTopLevelJsonValues(ONE)).toEqual([ONE])
  })

  it("separates values that were concatenated without a delimiter", () => {
    expect(splitTopLevelJsonValues(EMPTY + ONE)).toEqual([EMPTY, ONE])
  })

  it("separates three of them", () => {
    expect(splitTopLevelJsonValues(EMPTY + EMPTY + EMPTY)).toEqual([EMPTY, EMPTY, EMPTY])
  })

  it("is not fooled by braces inside strings", () => {
    const tricky = '{"foundProblems":[{"severity":1,"description":"}{ и \\" кавычка","fixProposal":"x"}]}'
    expect(splitTopLevelJsonValues(tricky + EMPTY)).toEqual([tricky, EMPTY])
  })

  it("tolerates whitespace and newlines between values", () => {
    expect(splitTopLevelJsonValues(`${EMPTY}\n\n  ${ONE}`)).toEqual([EMPTY, ONE])
  })

  it("returns a single span for a truncated value — there is nothing to split", () => {
    expect(splitTopLevelJsonValues('{"foundProblems":[')).toEqual(['{"foundProblems":['])
  })
})

describe("parseFoundProblems", () => {
  it("parses a well-formed findings payload", () => {
    expect(parseFoundProblems(ONE, "World review").foundProblems).toHaveLength(1)
  })

  it("accepts an empty findings list — nothing found is a valid answer", () => {
    expect(parseFoundProblems(EMPTY, "World review").foundProblems).toEqual([])
  })

  it("takes the last value when the model repeats itself", () => {
    // Observed on grok-4.7 with web_search on: output_chars came back as 21, 42
    // and 63 — the same object emitted once, twice and three times, glued
    // together inside a single output item.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseFoundProblems(EMPTY + EMPTY, "World review").foundProblems).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("takes the findings, not the empty first answer", () => {
    // The dangerous shape: an empty object followed by real findings. Taking
    // the first value would silently drop every finding.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseFoundProblems(EMPTY + ONE, "World review").foundProblems).toHaveLength(1)
    warn.mockRestore()
  })

  it("keeps the offending text in the message when the payload is not JSON at all", () => {
    let message = ""
    try {
      parseFoundProblems("Sorry, I cannot help with that.", "World review")
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).toContain("World review")
    expect(message, "the raw answer is the only evidence of what went wrong").toContain(
      "Sorry, I cannot help with that.",
    )
  })

  it("truncates a huge payload instead of pasting it whole into the message", () => {
    let message = ""
    try {
      parseFoundProblems(`nonsense${"x".repeat(5000)}`, "World review")
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message.length).toBeLessThan(1200)
    expect(message).toContain("…")
  })

  it("reports an empty answer as such rather than as a parse position", () => {
    let message = ""
    try {
      parseFoundProblems("   ", "World review")
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).toContain("empty")
  })
})
