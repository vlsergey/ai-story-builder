import { describe, expect, it } from "vitest"
import {
  GROK_4_3_REAL_RESPONSE_COMPLETED,
  LEGACY_TOTAL_COST_RESPONSE_COMPLETED,
  NO_COST_RESPONSE_COMPLETED,
} from "./generate-with-telemetry.fixtures.js"
import { extractProviderCostUsd } from "./generate-with-telemetry.js"

describe("extractProviderCostUsd", () => {
  it("converts Grok 4.3 cost_in_usd_ticks (1 tick = 1e-10 USD) to USD", () => {
    // Fixture: 5_018_500 ticks for a small Grok 4.3 call → $0.00050185
    const usd = extractProviderCostUsd(GROK_4_3_REAL_RESPONSE_COMPLETED.response)
    expect(usd).toBeCloseTo(5_018_500 * 1e-10, 12)
    expect(usd).toBeCloseTo(0.00050185, 8)
  })

  it("returns legacy usage.total_cost as USD when present", () => {
    const usd = extractProviderCostUsd(LEGACY_TOTAL_COST_RESPONSE_COMPLETED.response)
    expect(usd).toBe(0.0042)
  })

  it("returns null when the response has no recognised cost field", () => {
    expect(extractProviderCostUsd(NO_COST_RESPONSE_COMPLETED.response)).toBeNull()
  })

  it("returns null on non-object / nullish input", () => {
    expect(extractProviderCostUsd(null)).toBeNull()
    expect(extractProviderCostUsd(undefined)).toBeNull()
    expect(extractProviderCostUsd(42)).toBeNull()
    expect(extractProviderCostUsd("oops")).toBeNull()
  })

  it("ignores non-finite values (NaN, Infinity) — same as missing", () => {
    expect(extractProviderCostUsd({ usage: { cost_in_usd_ticks: Number.NaN } })).toBeNull()
    expect(extractProviderCostUsd({ usage: { cost_in_usd_ticks: Number.POSITIVE_INFINITY } })).toBeNull()
    expect(extractProviderCostUsd({ usage: { total_cost: Number.NaN } })).toBeNull()
  })
})
