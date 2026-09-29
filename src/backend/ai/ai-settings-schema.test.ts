import { describe, expect, it } from "vitest"
import { type AiEngineDefinition, BUILTIN_ENGINES } from "../../shared/ai-engines.js"
import { getAiGenerationSettingsSchema } from "../../shared/ai-generation-settings.js"

/**
 * An empty numeric field means "not set — let the provider decide". A zero is
 * a zero. `z.coerce.number()` turned "" into 0, which made the two
 * indistinguishable, and every adapter then had to guess that a stored 0 meant
 * "empty" — so a real zero could never be asked for.
 *
 * Cases are generated from the engine definitions, so a numeric field added
 * later is covered without touching this file.
 */
const numericFields: Array<[string, string, AiEngineDefinition]> = BUILTIN_ENGINES.flatMap((engine) =>
  engine.aiSettingsFields
    .filter((f) => f.type === "integer" || f.type === "decimal")
    .map((f) => [engine.id, f.key, engine] as [string, string, AiEngineDefinition]),
)

const engine = (id: string) => BUILTIN_ENGINES.find((e) => e.id === id) as AiEngineDefinition
const parse = (id: string, input: Record<string, unknown>) => getAiGenerationSettingsSchema(engine(id)).parse(input)
const safeParse = (id: string, input: Record<string, unknown>) =>
  getAiGenerationSettingsSchema(engine(id)).safeParse(input)

describe("AI settings schema — an empty field is not a zero", () => {
  it("finds numeric fields to check", () => {
    expect(numericFields.length).toBeGreaterThan(0)
  })

  it.each(numericFields)("%s.%s: an empty input is stored as absent", (_id, key, def) => {
    const out = getAiGenerationSettingsSchema(def).parse({ [key]: "" }) as Record<string, unknown>
    expect(out[key]).toBeUndefined()
  })

  it.each(numericFields)("%s.%s: a blank input is stored as absent", (_id, key, def) => {
    const out = getAiGenerationSettingsSchema(def).parse({ [key]: "   " }) as Record<string, unknown>
    expect(out[key]).toBeUndefined()
  })

  it.each(numericFields)("%s.%s: an untouched field stays absent", (_id, key, def) => {
    const out = getAiGenerationSettingsSchema(def).parse({}) as Record<string, unknown>
    expect(out[key]).toBeUndefined()
  })
})

describe("AI settings schema — a zero is a zero", () => {
  it.each([
    ["grok", "temperature"],
    ["grok", "top_p"],
    ["ollama", "temperature"],
    ["ollama", "top_p"],
  ])("%s.%s: a typed 0 survives as 0", (id, key) => {
    expect((parse(id, { [key]: "0" }) as Record<string, unknown>)[key]).toBe(0)
  })

  it("keeps ordinary values", () => {
    expect(parse("grok", { temperature: "0.7", max_output_tokens: "4000" })).toMatchObject({
      temperature: 0.7,
      max_output_tokens: 4000,
    })
  })
})

describe("AI settings schema — a zero token budget is refused, not reinterpreted", () => {
  // «0 = no limit» was the other half of the same conflation. Zero tokens of
  // output, or a zero-token context, is not a setting anyone can mean — so it
  // is rejected rather than silently read as "unlimited".
  it.each([
    ["grok", "max_output_tokens"],
    ["yandex", "max_completion_tokens"],
    ["ollama", "max_output_tokens"],
    ["ollama", "num_ctx"],
  ])("%s.%s: 0 is invalid", (id, key) => {
    expect(safeParse(id, { [key]: "0" }).success).toBe(false)
  })
})
