import { describe, expect, it } from "vitest"
import type { PlanNodeRow } from "../../../shared/plan-graph.js"
import { templateVariables, usesInput } from "./input-relevance.js"

function node(fields: Partial<PlanNodeRow>): PlanNodeRow {
  return { id: 1, title: "N", type: "text", node_type_settings: null, ...fields } as PlanNodeRow
}

describe("templateVariables", () => {
  it("finds every form a prompt uses to read an input", () => {
    const variables = templateVariables(
      '{{[Черновик мира]}} {{Plain}} {{#if (contains [Чанк] "x")}}ok{{/if}} {{#each [Список]}}{{this}}{{../[Стиль]}}{{/each}} {{[Реестр].length}}',
    )
    expect([...(variables ?? [])]).toEqual(
      expect.arrayContaining(["Черновик мира", "Plain", "Чанк", "Список", "Стиль", "Реестр"]),
    )
  })

  it("ignores data variables and this", () => {
    const variables = templateVariables("{{#each [List]}}{{@index}}{{this}}{{/each}}")
    expect(variables?.has("index")).toBe(false)
    expect(variables?.has("this")).toBe(false)
  })

  it("gives up on a template that does not parse", () => {
    expect(templateVariables("{{#if x}}unclosed")).toBeNull()
  })
})

describe("usesInput", () => {
  const source = node({ id: 7, title: "Стиль" })

  it("a text node reads an input its prompt names in bracket form", () => {
    const consumer = node({ node_type_settings: JSON.stringify({ userPrompt: "## Стиль\n{{[Стиль]}}" }) })
    expect(usesInput(consumer, source)).toBe(true)
  })

  it("a text node reads an input its system prompt names", () => {
    const consumer = node({ node_type_settings: JSON.stringify({ userPrompt: "x", systemPrompt: "{{[Стиль]}}" }) })
    expect(usesInput(consumer, source)).toBe(true)
  })

  it("a text node does not read an input no prompt names", () => {
    const consumer = node({ node_type_settings: JSON.stringify({ userPrompt: "{{[Мир]}}" }) })
    expect(usesInput(consumer, source)).toBe(false)
  })

  it("a text node without a prompt reads nothing", () => {
    expect(usesInput(node({}), source)).toBe(false)
  })

  it("a prompt that does not parse is assumed to read everything", () => {
    const consumer = node({ node_type_settings: JSON.stringify({ userPrompt: "{{#if broken" }) })
    expect(usesInput(consumer, source)).toBe(true)
  })

  it("fix-problems reads the text it fixes even when no instruction names it", () => {
    const consumer = node({
      type: "fix-problems",
      node_type_settings: JSON.stringify({ sourceNodeIdToFix: 7, aiUserInstructionsToFindProblems: "{{[Мир]}}" }),
    })
    expect(usesInput(consumer, source)).toBe(true)
  })

  it("fix-problems does not read an input that is neither fixed nor named", () => {
    const consumer = node({
      type: "fix-problems",
      node_type_settings: JSON.stringify({ sourceNodeIdToFix: 99, aiUserInstructionsToFixProblems: "{{[Мир]}}" }),
    })
    expect(usesInput(consumer, source)).toBe(false)
  })

  it("merge, format and containers read every input", () => {
    for (const type of ["merge", "format", "script", "for-each", "for-each-output"] as const) {
      expect(usesInput(node({ type }), source), type).toBe(true)
    }
  })
})
