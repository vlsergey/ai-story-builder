import { describe, expect, it } from "vitest"
import { estimateCostUsd } from "./pricing.js"

describe("estimateCostUsd", () => {
  it("returns null for an unknown engine/model pair", () => {
    expect(estimateCostUsd("grok", "unknown-model", { input_tokens: 1000 })).toBeNull()
    expect(estimateCostUsd("unknown-engine", "grok-3", { input_tokens: 1000 })).toBeNull()
  })

  it("returns null when no tokens were used", () => {
    expect(estimateCostUsd("grok", "grok-3", {})).toBeNull()
  })

  it("computes grok-3 cost on uncached input + output", () => {
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(estimateCostUsd("grok", "grok-3", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(18, 4)
  })

  it("applies the cached-input discount", () => {
    // grok-3: 1M cached input @ $0.75 + 1M output @ $15 = $15.75
    // input_tokens here is the FULL prompt size; cached_prompt_tokens is the cached subset.
    expect(
      estimateCostUsd("grok", "grok-3", {
        input_tokens: 1_000_000,
        cached_prompt_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ).toBeCloseTo(15.75, 4)
  })

  it("treats input_tokens minus cached_prompt_tokens as the uncached chunk", () => {
    // 800k uncached @ $3 = $2.40
    // 200k cached @ $0.75 = $0.15
    // 0 output → $2.55 total
    expect(
      estimateCostUsd("grok", "grok-3", {
        input_tokens: 1_000_000,
        cached_prompt_tokens: 200_000,
        output_tokens: 0,
      }),
    ).toBeCloseTo(2.55, 4)
  })
})
