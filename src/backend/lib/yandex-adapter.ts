import type OpenAI from "openai"
import type { AiEngineAdapter, GenerateResponseRequest } from "./ai-engine-adapter.js"
import type { YandexAiGenerationSettings } from "../../shared/yandex-ai-generation-settings.js"
import { createYandexClient } from "./yandex-client.js"
import { SettingsRepository } from "../settings/settings-repository.js"

export class YandexAdapter implements AiEngineAdapter<YandexAiGenerationSettings> {
  async generateResponse(
    req: GenerateResponseRequest<YandexAiGenerationSettings>,
    onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
  ): Promise<string> {
    const engineConfig = SettingsRepository.getAllAiEnginesConfig().yandex ?? {}

    const apiKey = engineConfig?.api_key?.trim()
    const folderId = engineConfig?.folder_id?.trim()
    if (!apiKey || !folderId) throw new Error("Yandex api_key and folder_id are required")

    const actualAiSettings = {
      ...engineConfig.defaultAiSettings,
      ...req.aiGenerationSettings,
    }

    const model = actualAiSettings.model || `gpt://${folderId}/yandexgpt/latest`
    const client = createYandexClient(apiKey, folderId)

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
    if (req.systemPrompt) {
      messages.push({ role: "system", content: req.systemPrompt })
    }
    if (req.userPrompt) {
      messages.push({ role: "user", content: req.userPrompt })
    }

    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      ...(actualAiSettings.maxTokens != null ? { max_tokens: actualAiSettings.maxTokens } : {}),
      ...(actualAiSettings.maxCompletionTokens != null
        ? { max_completion_tokens: actualAiSettings.maxCompletionTokens }
        : {}),
    }

    if (req.responseSchema && req.stringFormat !== false) {
      ;(requestParams as unknown as Record<string, unknown>).response_format = {
        type: "json_schema",
        json_schema: {
          name: req.responseSchema.name,
          schema: req.responseSchema.schema,
          strict: true,
        },
      }
    }

    const tools: unknown[] = []
    if (req.includeExistingLore) {
      const searchIndexId = engineConfig?.search_index_id
      tools.push({ type: "file_search", file_search: { vector_store_ids: [searchIndexId] } })
    }
    if (actualAiSettings.webSearch && actualAiSettings.webSearch !== "none") {
      tools.push({ type: "web_search", web_search: { search_context_size: actualAiSettings.webSearch } })
    }
    if (tools.length > 0) {
      ;(requestParams as unknown as Record<string, unknown>).tools = tools
    }

    const completion = await client.chat.completions.create(requestParams)
    return completion.choices[0]?.message?.content ?? ""
  }
}
