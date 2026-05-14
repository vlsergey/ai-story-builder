import type OpenAI from "openai"
import { recordCall } from "../lib/telemetry/telemetry.js"
import type { AiEngineAdapter, GenerateResponseRequest } from "./ai-engine-adapter.js"

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
  onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void
}): Promise<string> {
  const { engineId, adapter, request, instructionsTemplateChars, node, purpose: purposeOverride, onEvent } = args
  const t0 = Date.now()

  // Holder object instead of a bare `let` so TS doesn't narrow `usage` to
  // `null` through control-flow analysis (the reassignment happens inside a
  // closure that TS treats as opaque).
  const usageHolder: { current: Partial<OpenAI.Responses.ResponseUsage> | null } = { current: null }
  const onEventWrapped = (event: OpenAI.Responses.ResponseStreamEvent) => {
    if (event.type === "response.completed") {
      const u = (event as any).response?.usage
      if (u) usageHolder.current = u
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
    })
  }
}
