import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ProjectTemplate } from "../../shared/project-template.js"
import { setUpTestDb, tearDownTestDb } from "../db/test-db-utils.js"
import { applyProjectTemplate, normalizeAndReplaceContent, wizardSubstitutions } from "./apply-project-template.js"

describe("wizardSubstitutions — what each ${name} becomes", () => {
  const template = {
    label: "t",
    description: "t",
    wizardPages: [
      {
        id: "p",
        title: "p",
        fields: [
          {
            name: "minAge",
            type: "select",
            label: "Minimum age",
            defaultValue: "none",
            options: [
              { value: "none", label: "Not specified", text: "" },
              { value: "21", label: "21+", text: "All characters are at least 21 years old." },
              { value: "plain", label: "Plain" },
            ],
          },
          { name: "chunks", type: "integer", label: "Chunks", min: 1, max: 9, defaultValue: 4 },
          { name: "synopsis", type: "textarea", label: "Synopsis" },
        ],
      },
    ],
  } as ProjectTemplate

  it("turns a select's choice into its option's text", () => {
    expect(wizardSubstitutions(template, { minAge: "21" }).minAge).toBe("All characters are at least 21 years old.")
    expect(wizardSubstitutions(template, { minAge: "none" }).minAge).toBe("")
  })

  it("lets an option without a text stand for itself", () => {
    expect(wizardSubstitutions(template, { minAge: "plain" }).minAge).toBe("plain")
  })

  it("gives a field the project holds no value for the template's default", () => {
    const values = wizardSubstitutions(template, { synopsis: "S" })
    expect(values).toEqual({ minAge: "", chunks: 4, synopsis: "S" })
  })

  it("falls back to the default for a choice the template no longer offers", () => {
    expect(wizardSubstitutions(template, { minAge: "18" }).minAge).toBe("")
  })
})

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

describe("applyProjectTemplate — where nodes may go", () => {
  beforeEach(() => setUpTestDb())
  afterEach(() => tearDownTestDb())

  it("refuses the memory of earlier iterations inside a parallel loop", () => {
    const template = {
      label: "t",
      description: "t",
      wizardPages: [],
      plan: {
        nodes: [
          { title: "List", type: "split", aiUserInstructions: ["List."], inputs: [] },
          {
            title: "Loop",
            type: "parallel",
            inputs: [{ sourceNodeTitle: "List", type: "textArray" }],
            children: [
              { title: "Element", type: "for-each-input" },
              { title: "Earlier", type: "for-each-prev-outputs" },
              { title: "Result", type: "for-each-output" },
            ],
          },
        ],
      },
    } as unknown as ProjectTemplate

    expect(() => applyProjectTemplate(template, {})).toThrow(/for-each-prev-outputs/)
  })
})
