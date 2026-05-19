import { describe, expect, it } from "vitest"
import { normalizeAndReplaceContent } from "./apply-project-template.js"

describe("normalizeAndReplaceContent — wizard variable substitution", () => {
  it("joins lines with \\n", () => {
    expect(normalizeAndReplaceContent(["a", "b", "c"], {})).toBe("a\nb\nc")
  })

  it("substitutes bare identifier ${name} with templateData[name]", () => {
    expect(normalizeAndReplaceContent(["${who}"], { who: "world" })).toBe("world")
  })

  it("substitutes missing bare identifier with empty string (back-compat)", () => {
    expect(normalizeAndReplaceContent(["[${missing}]"], {})).toBe("[]")
  })

  it("passes non-numeric string values through", () => {
    expect(normalizeAndReplaceContent(["[${rating}]"], { rating: "18+" })).toBe("[18+]")
  })

  it("non-identifier expression substitutes empty (arithmetic moved to Handlebars math helpers)", () => {
    // Pre-Wave1 the apply pass evaluated `${round(1400/n)}` via expr-eval.
    // Now the apply pass only substitutes bare identifiers — anything with
    // operators or function calls is rejected as malformed (template author
    // should write it as Handlebars: `{{round (divide 1400 ${n})}}`).
    expect(normalizeAndReplaceContent(["${round(1400/n)}"], { n: 3 })).toBe("")
    expect(normalizeAndReplaceContent(["${nonsense(@@}"], {})).toBe("")
    expect(normalizeAndReplaceContent(["${missing+1}"], {})).toBe("")
  })
})
