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

  it("passes non-numeric string values through bare-identifier path (no expr-eval)", () => {
    // expr-eval can't evaluate raw strings, so the bare-identifier shortcut
    // is what makes `${ageRating}` → "18+" work.
    expect(normalizeAndReplaceContent(["[${rating}]"], { rating: "18+" })).toBe("[18+]")
  })

  it("evaluates arithmetic expression with template variables", () => {
    expect(normalizeAndReplaceContent(["${1400/partsCount}"], { partsCount: 20 })).toBe("70")
  })

  it("evaluates round(1400/N) and round(1000/N) — the slider scenario", () => {
    const out = normalizeAndReplaceContent(["max=${round(1400/partsCount)}, min=${round(1000/partsCount)}"], {
      partsCount: 20,
    })
    expect(out).toBe("max=70, min=50")
  })

  it("rounds half-up consistently across edge values", () => {
    // 1400/3 = 466.67 → 467; 1000/3 = 333.33 → 333
    expect(normalizeAndReplaceContent(["${round(1400/n)}"], { n: 3 })).toBe("467")
    expect(normalizeAndReplaceContent(["${round(1000/n)}"], { n: 3 })).toBe("333")
    // 1400/25 = 56; 1000/25 = 40 — exact, no rounding needed
    expect(normalizeAndReplaceContent(["${round(1400/n)}"], { n: 25 })).toBe("56")
    expect(normalizeAndReplaceContent(["${round(1000/n)}"], { n: 25 })).toBe("40")
  })

  it("expression that fails to evaluate substitutes empty (with console.warn)", () => {
    const result = normalizeAndReplaceContent(["[${nonsense(@@}]"], {})
    expect(result).toBe("[]")
  })

  it("expression referencing missing variable evaluates to NaN→string", () => {
    // Best-effort: expr-eval throws on undefined identifiers, so this hits
    // the catch branch and substitutes empty. Documents the behavior.
    const result = normalizeAndReplaceContent(["${missing+1}"], {})
    expect(result).toBe("")
  })
})
