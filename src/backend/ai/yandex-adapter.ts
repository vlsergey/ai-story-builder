import type { AiEngineConfig } from "@shared/ai-engine-config.js"
import type OpenAI from "openai"
import type { ResponseCreateParamsStreaming, Tool } from "openai/resources/responses/responses.js"
import type { YandexAiGenerationSettings } from "../../shared/yandex-ai-generation-settings.js"
import type { AiEngineAdapter, GenerateResponseRequest } from "../ai/ai-engine-adapter.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { isVerboseLogging } from "./ai-logging.js"
import lastAiGenerationEventManager from "./last-ai-generation-event-manager.js"
import { createYandexClient } from "./yandex-client.js"

export class YandexAdapter implements AiEngineAdapter<YandexAiGenerationSettings> {
  async generateResponse(
    req: GenerateResponseRequest<YandexAiGenerationSettings>,
    onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
  ): Promise<string> {
    const engineConfig = req.engineConfig ?? SettingsRepository.getAllAiEnginesConfig().yandex ?? {}

    const apiKey = engineConfig?.api_key?.trim()
    const folderId = engineConfig?.folder_id?.trim()
    if (!apiKey || !folderId) throw new Error("Yandex api_key and folder_id are required")

    const actualAiSettings = {
      ...engineConfig.defaultAiSettings,
      ...req.aiGenerationSettings,
    }

    const model = actualAiSettings.model || `gpt://${folderId}/yandexgpt/latest`
    const client = createYandexClient(apiKey, folderId)

    // Use Yandex's Responses API (POST /v1/responses) — same shape as
    // OpenAI/Grok. Their chat.completions endpoint accepts only
    // `type: "function"` tools (no web_search / file_search there), so we
    // route through Responses where the native built-in tools work.
    // Docs: https://aistudio.yandex.ru/docs/ru/ai-studio/responses/createResponse.html
    const requestParams: Omit<ResponseCreateParamsStreaming, "stream"> = {
      model,
      instructions: req.systemPrompt ?? "",
      input: req.userPrompt || "",
      ...(actualAiSettings.maxCompletionTokens != null
        ? { max_output_tokens: actualAiSettings.maxCompletionTokens }
        : {}),
    }

    const tools: Array<Tool> = []
    if (actualAiSettings.webSearch && actualAiSettings.webSearch !== "none") {
      tools.push({
        type: "web_search",
        search_context_size: actualAiSettings.webSearch,
      } as unknown as Tool)
    }
    if (req.includeExistingLore) {
      const searchIndexId = engineConfig?.search_index_id
      if (searchIndexId) {
        tools.push({
          type: "file_search",
          vector_store_ids: [searchIndexId],
        } as unknown as Tool)
      }
    }
    if (tools.length > 0) {
      requestParams.tools = tools
    }

    if (req.responseSchema && req.stringFormat !== false) {
      requestParams.text = {
        format: {
          type: "json_schema",
          name: req.responseSchema.name,
          ...(req.responseSchema.description ? { description: req.responseSchema.description } : {}),
          strict: true,
          schema: req.responseSchema.schema,
        },
      }
    }

    const stream = await client.responses.create(
      { ...requestParams, stream: true } satisfies ResponseCreateParamsStreaming,
      { signal: req.abortSignal },
    )

    let text = ""
    for await (const event of stream) {
      if (isVerboseLogging()) {
        const { type, ...rest } = event as any
        console.log(`[Yandex] SSE ${type} ${JSON.stringify(rest)}`)
      }
      onEvent?.(event)

      switch (event.type) {
        case "response.output_text.delta":
          text += event.delta
          break
        case "response.completed":
          lastAiGenerationEventManager.onAiGenerationEvent({ ...event.response?.usage })
          break
        case "response.failed":
          throw new Error(
            `Yandex response failed: ${JSON.stringify((event.response as { error?: unknown }).error ?? {})}`,
          )
        case "response.incomplete":
          throw new Error(
            "[Yandex] response incomplete: " +
              JSON.stringify((event.response as { incomplete_details?: unknown }).incomplete_details ?? {}),
          )
      }
    }

    return text
  }

  async testConnectivity(
    settings: AiEngineConfig<YandexAiGenerationSettings>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const apiKey = settings.api_key?.trim()
    const folderId = settings.folder_id?.trim()
    if (!apiKey) throw makeErrorWithStatus("api_key is required", 400)
    if (!folderId) throw makeErrorWithStatus("folder_id is required", 400)

    const r = await fetch("https://ai.api.cloud.yandex.net/v1/models", {
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "x-folder-id": folderId,
      },
    })
    if (r.ok) {
      const data = (await r.json()) as { data?: unknown[] }
      const count = Array.isArray(data.data) ? data.data.length : 0
      return { ok: true, detail: `Connected. ${count} model(s) available.` }
    } else {
      const body = await r.text()
      return { ok: false, error: `HTTP ${r.status}: ${body}` }
    }
  }
}
