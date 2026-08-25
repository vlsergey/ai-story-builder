import type OpenAI from "openai"
import type { OllamaAiGenerationSettings } from "../../shared/ollama-ai-generation-settings.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import type { AiEngineAdapter, GenerateResponseRequest } from "./ai-engine-adapter.js"
import lastAiGenerationEventManager from "./last-ai-generation-event-manager.js"
import { buildChatRequest, DEFAULT_OLLAMA_BASE_URL, streamOllamaChat } from "./ollama-client.js"

/**
 * Local models via Ollama. No API key, no per-token cost, no network egress —
 * which also means no `web_search`, no file upload, and no provider-reported
 * usage cost. Usage counts are reported so the telemetry pane still shows
 * token volume; cost stays absent rather than being invented.
 */
export class OllamaAdapter implements AiEngineAdapter<OllamaAiGenerationSettings> {
  async generateResponse(
    req: GenerateResponseRequest<OllamaAiGenerationSettings>,
    onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
  ): Promise<string> {
    const engineConfig = req.engineConfig ?? SettingsRepository.getAllAiEnginesConfig().ollama ?? {}
    const settings: OllamaAiGenerationSettings = {
      ...engineConfig.defaultAiGenerationSettings,
      ...req.aiGenerationSettings,
    }

    const model = settings.model?.trim()
    if (!model) throw new Error("Ollama model is required")

    const baseUrl = (engineConfig as { base_url?: string }).base_url?.trim() || DEFAULT_OLLAMA_BASE_URL

    const request = buildChatRequest({
      model,
      systemPrompt: req.systemPrompt,
      userPrompt: req.userPrompt,
      settings,
      responseSchema: req.responseSchema,
      enforceSchema: req.stringFormat !== false,
    })

    let text = ""
    let promptTokens: number | undefined
    let outputTokens: number | undefined

    for await (const chunk of streamOllamaChat(baseUrl, request, req.abortSignal)) {
      const delta = chunk.message?.content
      if (delta) {
        text += delta
        onEvent?.({
          type: "response.output_text.delta",
          delta,
        } as unknown as OpenAI.Responses.ResponseStreamEvent)
      }
      if (chunk.done) {
        promptTokens = chunk.prompt_eval_count
        outputTokens = chunk.eval_count
      }
    }

    const usage = {
      input_tokens: promptTokens ?? 0,
      output_tokens: outputTokens ?? 0,
      total_tokens: (promptTokens ?? 0) + (outputTokens ?? 0),
    }
    lastAiGenerationEventManager.onAiGenerationEvent(usage)
    onEvent?.({
      type: "response.completed",
      response: { usage },
    } as unknown as OpenAI.Responses.ResponseStreamEvent)

    return text
  }

  async testConnectivity(
    settings: import("@shared/ai-engine-config.js").AiEngineConfig<OllamaAiGenerationSettings>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const baseUrl = (settings as { base_url?: string }).base_url?.trim() || DEFAULT_OLLAMA_BASE_URL
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`)
      if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` }
      const body = (await res.json()) as { models?: Array<{ name?: string }> }
      const names = (body.models ?? []).map((m) => m.name).filter(Boolean)
      return { ok: true, detail: names.length > 0 ? names.join(", ") : "no models pulled" }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
