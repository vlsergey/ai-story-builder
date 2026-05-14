/**
 * Per-(engine, model) USD pricing for token usage, used to attach a `cost_usd`
 * estimate to telemetry records.
 *
 * Prices are listed per 1M tokens and reflect public list prices, not contract
 * or volume-discount rates. Update by hand when providers change tariffs; the
 * file is the source of truth, no remote lookup.
 *
 * Returns `null` when pricing for the given (engine, model) is unknown — the
 * caller stores `cost_usd = NULL` in that case rather than guessing.
 */

interface ModelPricing {
  /** USD per 1M input tokens (uncached). */
  inputPerMTokens: number
  /** USD per 1M cached prompt tokens (typically a fraction of the input rate). */
  cachedInputPerMTokens?: number
  /** USD per 1M output tokens. */
  outputPerMTokens: number
}

// Source: xAI public pricing page, approximate as of late 2025. xAI applies
// a 25% rate to cached prompt tokens across the line.
const GROK_PRICING: Record<string, ModelPricing> = {
  "grok-3": { inputPerMTokens: 3.0, cachedInputPerMTokens: 0.75, outputPerMTokens: 15.0 },
  "grok-3-fast": { inputPerMTokens: 5.0, cachedInputPerMTokens: 1.25, outputPerMTokens: 25.0 },
  "grok-3-mini": { inputPerMTokens: 0.3, cachedInputPerMTokens: 0.075, outputPerMTokens: 0.5 },
  "grok-3-mini-fast": { inputPerMTokens: 0.6, cachedInputPerMTokens: 0.15, outputPerMTokens: 4.0 },
  "grok-2-1212": { inputPerMTokens: 2.0, cachedInputPerMTokens: 0.5, outputPerMTokens: 10.0 },
  "grok-code-fast-1": { inputPerMTokens: 0.2, cachedInputPerMTokens: 0.05, outputPerMTokens: 1.5 },
}

// Yandex pricing is in rubles, exchange rate fluctuates, and the model id
// varies by folder. Leaving null until someone wires it in properly — the
// telemetry will still capture tokens, just without a USD cost.
const YANDEX_PRICING: Record<string, ModelPricing> = {}

const PRICING_BY_ENGINE: Record<string, Record<string, ModelPricing>> = {
  grok: GROK_PRICING,
  yandex: YANDEX_PRICING,
}

export interface TokenUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cached_prompt_tokens?: number | null
}

export function estimateCostUsd(engineId: string, model: string, usage: TokenUsage): number | null {
  const pricing = PRICING_BY_ENGINE[engineId]?.[model]
  if (!pricing) return null

  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cachedTokens = usage.cached_prompt_tokens ?? 0
  if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0) return null

  // Cached tokens are billed at a discount and are counted SEPARATELY from
  // input_tokens in the providers we care about (xAI mirrors OpenAI's
  // accounting). If a caller passes both, treat input_tokens as the
  // uncached portion.
  const uncachedInputTokens = Math.max(0, inputTokens - cachedTokens)
  const cachedRate = pricing.cachedInputPerMTokens ?? pricing.inputPerMTokens

  const cost =
    (uncachedInputTokens / 1_000_000) * pricing.inputPerMTokens +
    (cachedTokens / 1_000_000) * cachedRate +
    (outputTokens / 1_000_000) * pricing.outputPerMTokens

  return Number(cost.toFixed(6))
}
