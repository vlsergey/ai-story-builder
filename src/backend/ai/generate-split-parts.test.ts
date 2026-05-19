import { describe, expect, it } from "vitest"
import { buildSplitResponseSchema } from "./generate-split-parts.js"

describe("buildSplitResponseSchema", () => {
  it("omits items.description when partDescription is null", () => {
    const schema = buildSplitResponseSchema(null, null)
    const items = (schema.properties as Record<string, any>).parts.items
    expect(items).toEqual({ type: "string" })
  })

  it("omits items.description when partDescription is empty or whitespace", () => {
    for (const value of ["", "   ", "\n\t  "]) {
      const items = (buildSplitResponseSchema(value, null).properties as Record<string, any>).parts.items
      expect(items).toEqual({ type: "string" })
    }
  })

  it("injects trimmed partDescription into items.description", () => {
    const schema = buildSplitResponseSchema("  one plot beat, 100 words  ", null)
    const items = (schema.properties as Record<string, any>).parts.items
    expect(items).toEqual({ type: "string", description: "one plot beat, 100 words" })
  })

  it("keeps the outer envelope stable regardless of partDescription", () => {
    const schema = buildSplitResponseSchema("anything", null)
    expect(schema.type).toBe("object")
    expect(schema.required).toEqual(["parts"])
    expect(schema.additionalProperties).toBe(false)
    expect((schema.properties as Record<string, any>).parts.type).toBe("array")
  })

  it("pins minItems/maxItems when expectedPartsCount is a positive int", () => {
    const parts = (buildSplitResponseSchema("anything", 5).properties as Record<string, any>).parts
    expect(parts.minItems).toBe(5)
    expect(parts.maxItems).toBe(5)
  })

  it("ignores expectedPartsCount when zero or negative", () => {
    for (const n of [0, -1]) {
      const parts = (buildSplitResponseSchema(null, n).properties as Record<string, any>).parts
      expect(parts.minItems).toBeUndefined()
      expect(parts.maxItems).toBeUndefined()
    }
  })
})
