import { describe, expect, it } from "vitest"
import { replaceTemplates } from "./replaceTemplates.js"

describe("replaceTemplates — Handlebars bracket-notation substitution", () => {
  it("null content stays null", () => {
    expect(replaceTemplates(null, {})).toBe(null)
  })

  it("substitutes a bracket-notation placeholder", () => {
    expect(replaceTemplates("hello {{[Name]}}", { Name: "world" })).toBe("hello world")
  })

  it("substitutes Cyrillic node titles with spaces", () => {
    expect(replaceTemplates("[{{[Реестр сетапов и пэйоффов]}}]", { "Реестр сетапов и пэйоффов": "X" })).toBe("[X]")
  })

  it("throws on missing variable (strict)", () => {
    expect(() => replaceTemplates("{{[Missing]}}", {})).toThrow(/Template render failed/)
  })

  it("trims input before render (mirrors prior behaviour)", () => {
    expect(replaceTemplates("  {{[X]}}  ", { X: "y" })).toBe("y")
  })

  describe("helpers", () => {
    it("eq — equal", () => {
      expect(replaceTemplates('{{#if (eq mode "full")}}A{{else}}B{{/if}}', { mode: "full" })).toBe("A")
    })

    it("eq — not equal", () => {
      expect(replaceTemplates('{{#if (eq mode "full")}}A{{else}}B{{/if}}', { mode: "fragment" })).toBe("B")
    })

    it("ne — works", () => {
      expect(replaceTemplates('{{#if (ne mode "full")}}A{{else}}B{{/if}}', { mode: "fragment" })).toBe("A")
    })

    it("contains — substring present", () => {
      expect(
        replaceTemplates('{{#if (contains [Chunk] "fragment")}}A{{else}}B{{/if}}', { Chunk: "mode=fragment" }),
      ).toBe("A")
    })

    it("contains — substring absent", () => {
      expect(replaceTemplates('{{#if (contains [Chunk] "packed")}}A{{else}}B{{/if}}', { Chunk: "mode=fragment" })).toBe(
        "B",
      )
    })

    it("startsWith — prefix match", () => {
      expect(
        replaceTemplates('{{#if (startsWith [Title] "Полировка")}}P{{else}}X{{/if}}', { Title: "Полировка: голос" }),
      ).toBe("P")
    })

    it("endsWith — suffix match", () => {
      expect(
        replaceTemplates('{{#if (endsWith [Title] "continuity")}}C{{else}}X{{/if}}', {
          Title: "structure and continuity",
        }),
      ).toBe("C")
    })

    it("matches — regex pattern match", () => {
      expect(
        replaceTemplates('{{#if (matches [Chunk] "mode=(fragment|full)")}}M{{else}}X{{/if}}', { Chunk: "mode=full" }),
      ).toBe("M")
    })

    it("matches — regex with flags", () => {
      expect(
        replaceTemplates('{{#if (matches [Title] "полировка" "i")}}M{{else}}X{{/if}}', { Title: "Полировка: голос" }),
      ).toBe("M")
    })

    it("matches — bad regex returns false", () => {
      expect(replaceTemplates('{{#if (matches [X] "[unclosed")}}M{{else}}X{{/if}}', { X: "anything" })).toBe("X")
    })

    it("or — true if any operand truthy", () => {
      expect(replaceTemplates('{{#if (or (eq m "a") (eq m "b"))}}Y{{else}}N{{/if}}', { m: "b" })).toBe("Y")
      expect(replaceTemplates('{{#if (or (eq m "a") (eq m "b"))}}Y{{else}}N{{/if}}', { m: "c" })).toBe("N")
    })

    it("and — true only if all operands truthy", () => {
      expect(
        replaceTemplates('{{#if (and (contains x "fo") (contains x "ba"))}}Y{{else}}N{{/if}}', { x: "foobar" }),
      ).toBe("Y")
      expect(
        replaceTemplates('{{#if (and (contains x "fo") (contains x "qq"))}}Y{{else}}N{{/if}}', { x: "foobar" }),
      ).toBe("N")
    })

    it("not — flips truthiness", () => {
      expect(replaceTemplates('{{#if (not (eq m "a"))}}Y{{else}}N{{/if}}', { m: "b" })).toBe("Y")
      expect(replaceTemplates('{{#if (not (eq m "a"))}}Y{{else}}N{{/if}}', { m: "a" })).toBe("N")
    })
  })

  it("preserves angle brackets / special chars (no HTML escaping)", () => {
    expect(replaceTemplates("{{[X]}}", { X: "<b>hi</b> & 'quotes'" })).toBe("<b>hi</b> & 'quotes'")
  })

  it("combines plain substitution and conditional in same template", () => {
    const tpl = 'Hello {{[Name]}}.{{#if (eq tone "warm")}} Stay warm.{{/if}}'
    expect(replaceTemplates(tpl, { Name: "world", tone: "warm" })).toBe("Hello world. Stay warm.")
    expect(replaceTemplates(tpl, { Name: "world", tone: "cold" })).toBe("Hello world.")
  })
})
