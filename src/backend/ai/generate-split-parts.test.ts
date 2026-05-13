import { describe, expect, it } from "vitest"
import { buildSplitResponseSchema } from "./generate-split-parts.js"

describe("buildSplitResponseSchema", () => {
  it("omits items.description when partDescription is null", () => {
    const schema = buildSplitResponseSchema(null)
    const items = (schema.properties as Record<string, any>).parts.items
    expect(items).toEqual({ type: "string" })
  })

  it("omits items.description when partDescription is empty or whitespace", () => {
    for (const value of ["", "   ", "\n\t  "]) {
      const items = (buildSplitResponseSchema(value).properties as Record<string, any>).parts.items
      expect(items).toEqual({ type: "string" })
    }
  })

  it("injects trimmed partDescription into items.description", () => {
    const schema = buildSplitResponseSchema("  one plot beat, 100 words  ")
    const items = (schema.properties as Record<string, any>).parts.items
    expect(items).toEqual({ type: "string", description: "one plot beat, 100 words" })
  })

  it("keeps the outer envelope stable regardless of partDescription", () => {
    const schema = buildSplitResponseSchema("anything")
    expect(schema.type).toBe("object")
    expect(schema.required).toEqual(["parts"])
    expect(schema.additionalProperties).toBe(false)
    expect((schema.properties as Record<string, any>).parts.type).toBe("array")
  })
})
