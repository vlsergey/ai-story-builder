import { describe, expect, it } from "vitest"
import { templateVariables } from "./input-relevance.js"

/**
 * The syntax a prompt can use to read an input. Which re-runs follow from it
 * is covered by the scenarios in `plan/scenario`.
 */
describe("templateVariables", () => {
  it("finds every form a prompt uses to read an input", () => {
    const variables = templateVariables(
      '{{[Черновик мира]}} {{Plain}} {{#if (contains [Чанк] "x")}}ok{{/if}} {{#each [Список]}}{{this}}{{../[Стиль]}}{{/each}} {{[Реестр].length}}',
    )
    expect([...(variables ?? [])]).toEqual(
      expect.arrayContaining(["Черновик мира", "Plain", "Чанк", "Список", "Стиль", "Реестр"]),
    )
  })

  it("finds an input read from the root inside a block, or through lookup", () => {
    const variables = templateVariables(
      '{{#each [Список]}}{{@root.[Синопсис]}}{{/each}} {{lookup . "Стиль"}} {{#if (lookup . "Мир")}}ok{{/if}}',
    )
    expect([...(variables ?? [])]).toEqual(expect.arrayContaining(["Синопсис", "Стиль", "Мир"]))
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
