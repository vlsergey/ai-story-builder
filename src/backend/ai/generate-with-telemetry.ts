import type OpenAI from "openai"
import { recordCall } from "../lib/telemetry/telemetry.js"
import type { AiEngineAdapter, GenerateResponseRequest } from "./ai-engine-adapter.js"

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * xAI Grok exposes per-call cost in `response.usage.cost_in_usd_ticks` —
 * integer count of "ticks", where one tick is 1e-10 USD (matching the
 * `USD_PER_TICK` constant the frontend's `AiBillingPanel` uses to render
 * the same value).
 *
 * Historically the field was sometimes named `usage.total_cost` (already
 * in USD) or just `total_cost` — keep those known paths as fallbacks for
 * older Grok versions and other OpenAI-compatible providers.
 *
 * Returns USD as a regular number, or null when the response carries no
 * cost field we recognise. Callers must NOT substitute a calculated price —
 * cost_usd in telemetry is intentionally `null` if the provider didn't
 * report.
 */
const USD_PER_TICK = 1e-10

export function extractProviderCostUsd(response: unknown): number | null {
  if (response == null || typeof response !== "object") return null
  const r = response as { usage?: Record<string, unknown> } & Record<string, unknown>
  const usage = r.usage
  const ticks = pickNumber(usage?.cost_in_usd_ticks)
  if (ticks != null) return ticks * USD_PER_TICK
  return (
    pickNumber(usage?.total_cost) ?? pickNumber(usage?.cost) ?? pickNumber(r.total_cost) ?? pickNumber(r.cost) ?? null
  )
}

/**
 * Wraps `adapter.generateResponse` with per-call telemetry recording.
 *
 * Captures duration and output text length around the call, captures token
 * usage via the `response.completed` SSE event, and records one ai_call_stats
 * row + one JSONL line. Failures are recorded too (success = false) before
 * re-throwing — caller behaviour is unchanged.
 */
export async function generateWithTelemetry(args: {
  engineId: string
  adapter: AiEngineAdapter
  request: GenerateResponseRequest
  /**
   * Length of system + user prompt *templates* BEFORE wizard / placeholder
   * substitution. Characterises the template node, not the rendered call.
   */
  instructionsTemplateChars: number
  node?: { title?: string | null; type?: string | null } | null
  /**
   * Override the recorded `purpose`. Defaults to `request.promptCacheKeys[0]`.
   * Use when prompt cache keys are intentionally shared between distinct call
   * roles (e.g. find-problems and fix-problems both reuse the text-gen cache
   * key) so the telemetry can still tell them apart.
   */
  purpose?: string
  /**
   * Zero-based iteration index for callers that loop (currently fix-problems).
   * Passed through to `recordCall` for the aggregator's "iterations per visit"
   * analysis.
   */
  iterationIndex?: number | null
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void
}): Promise<string> {
  const {
    engineId,
    adapter,
    request,
    instructionsTemplateChars,
    node,
    purpose: purposeOverride,
    iterationIndex,
    onEvent,
  } = args
  const t0 = Date.now()

  // Holder objects instead of bare `let`s so TS doesn't narrow values to
  // `null` through control-flow analysis (the reassignment happens inside a
  // closure that TS treats as opaque).
  const usageHolder: { current: Partial<OpenAI.Responses.ResponseUsage> | null } = { current: null }
  const reportedCostHolder: { current: number | null } = { current: null }
  const onEventWrapped = (event: OpenAI.Responses.ResponseStreamEvent) => {
    if (event.type === "response.completed") {
      const response: any = (event as any).response
      if (response?.usage) usageHolder.current = response.usage
      // Provider-reported cost. See `extractProviderCostUsd` for the path /
      // scale lookup and `RecordCallArgs.reported_cost_usd` for why we do
      // not substitute a calculated fallback when the provider stays silent.
      const provider_cost = extractProviderCostUsd(response)
      if (provider_cost != null) reportedCostHolder.current = provider_cost
    }
    onEvent?.(event)
  }

  let text = ""
  let success = true
  let error_message: string | null = null

  try {
    text = await adapter.generateResponse(request, onEventWrapped)
    return text
  } catch (err) {
    success = false
    error_message = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    const duration_ms = Date.now() - t0
    const purpose = purposeOverride ?? request.promptCacheKeys[0] ?? "unknown"
    const inputChars = (request.systemPrompt ?? "").length + (request.userPrompt ?? "").length
    const outputChars = text.length
    const model = request.aiGenerationSettings?.model ?? "unknown"
    const reasoningEffort = (request.aiGenerationSettings as { reasoning_effort?: string } | undefined)
      ?.reasoning_effort
    const usage = usageHolder.current
    const cachedPromptTokens =
      (usage as any)?.input_tokens_details?.cached_tokens ??
      (usage as any)?.prompt_tokens_details?.cached_tokens ??
      null

    recordCall({
      engine_id: engineId,
      model,
      purpose,
      prompt_cache_keys: request.promptCacheKeys,
      node_title: node?.title ?? null,
      node_type: node?.type ?? null,
      instructions_chars: instructionsTemplateChars,
      input_chars: inputChars,
      output_chars: outputChars,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      cached_prompt_tokens: cachedPromptTokens,
      duration_ms,
      success,
      error_message,
      reported_cost_usd: reportedCostHolder.current,
      iteration_index: iterationIndex ?? null,
      reasoning_effort: reasoningEffort ?? null,
    })
  }
}
