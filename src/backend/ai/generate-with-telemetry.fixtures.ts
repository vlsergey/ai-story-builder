/**
 * Real `response.completed` payloads captured by sending a minimal request to
 * each supported provider, with personally identifying / API-secret content
 * stripped. Used by `generate-with-telemetry.test.ts` to nail down which
 * field carries cost and at what scale, so a provider field rename / scale
 * change shows up as a test failure rather than silent null in telemetry.
 *
 * Pricing math against the Grok 4.3 fixture (verified against the in-app
 * billing panel's `USD_PER_TICK = 1e-10`):
 *
 *   cost_in_usd_ticks = 5_018_500
 *   → 5_018_500 * 1e-10 USD = $0.00050185
 *
 * If xAI ever renames or rescales the field, capture a fresh response with
 * `scripts/probe-grok-response.ts` and update this fixture + the constant.
 */

export const GROK_4_3_REAL_RESPONSE_COMPLETED = {
  sequence_number: 35,
  type: "response.completed",
  response: {
    id: "<redacted>",
    object: "response",
    model: "grok-4.3",
    status: "completed",
    created_at: 1778941856,
    completed_at: 1778941858,
    usage: {
      input_tokens: 147,
      input_tokens_details: { cached_tokens: 128 },
      output_tokens: 181,
      output_tokens_details: { reasoning_tokens: 179 },
      total_tokens: 328,
      num_sources_used: 0,
      num_server_side_tools_used: 0,
      cost_in_usd_ticks: 5_018_500,
    },
    metadata: { system_fingerprint: "<redacted>" },
  },
} as const

/**
 * Hand-built fixture mimicking the older Grok response shape that exposed
 * `usage.total_cost` directly as a USD number. Kept so the cost extractor
 * stays backwards-compatible if any deployment is still on that version.
 */
export const LEGACY_TOTAL_COST_RESPONSE_COMPLETED = {
  type: "response.completed",
  response: {
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      total_tokens: 300,
      total_cost: 0.0042,
    },
  },
} as const

export const NO_COST_RESPONSE_COMPLETED = {
  type: "response.completed",
  response: {
    usage: {
      input_tokens: 50,
      output_tokens: 50,
      total_tokens: 100,
    },
  },
} as const
