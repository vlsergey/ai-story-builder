import { describe, expect, it } from "vitest"
import { parseFoundProblems } from "./parse-found-problems.js"

describe("parseFoundProblems", () => {
  it("parses a well-formed findings payload", () => {
    const raw = '{"foundProblems":[{"severity":80,"description":"d","fixProposal":"f"}]}'
    expect(parseFoundProblems(raw, "World review").foundProblems).toHaveLength(1)
  })

  it("accepts an empty findings list — nothing found is a valid answer", () => {
    expect(parseFoundProblems('{"foundProblems":[]}', "World review").foundProblems).toEqual([])
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

  it("keeps the offending text when valid JSON is followed by junk", () => {
    // The failure that cost an investigation: a model returned a complete
    // object and then kept talking, and JSON.parse reported only a position.
    let message = ""
    try {
      parseFoundProblems('{"foundProblems": []} and here is why:', "World review")
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).toContain("and here is why")
  })

  it("truncates a huge payload instead of pasting it whole into the message", () => {
    const raw = `{"foundProblems": []}${"x".repeat(5000)}`
    let message = ""
    try {
      parseFoundProblems(raw, "World review")
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
