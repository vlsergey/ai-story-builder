import type OpenAI from 'openai'
import type { AiEngineAdapter, GenerateResponseRequest } from './ai-engine-adapter.js'
import { createYandexClient } from './yandex-client.js'

export class YandexAdapter implements AiEngineAdapter {
  async generateResponse(
    req: GenerateResponseRequest,
    onThinking: (status: string, detail?: string) => void,
    onDelta: (text: string) => void,
  ): Promise<{ response_id?: string }> {
    const apiKey = req.config.yandex?.api_key?.trim()
    const folderId = req.config.yandex?.folder_id?.trim()
    if (!apiKey || !folderId) throw new Error('Yandex api_key and folder_id are required')

    const model = req.model || `gpt://${folderId}/yandexgpt/latest`
    const client = createYandexClient(apiKey, folderId)

    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.prompt },
      ],
    }

    if (req.responseSchema) {
      ;(requestParams as unknown as Record<string, unknown>)['response_format'] = {
        type: 'json_schema',
        json_schema: {
          name: req.responseSchema.name,
          schema: req.responseSchema.schema,
          strict: true,
        },
      }
    }

    const tools: unknown[] = []
    if (req.includeExistingLore) {
      const searchIndexId = req.config.yandex?.search_index_id
      if (req.engineDef.capabilities.knowledgeBaseAttachment && searchIndexId) {
        tools.push({ type: 'file_search', file_search: { vector_store_ids: [searchIndexId] } })
      }
    }
    if (req.webSearch && req.webSearch !== 'none') {
      tools.push({ type: 'web_search', web_search: { search_context_size: req.webSearch } })
    }
    if (tools.length > 0) {
      ;(requestParams as unknown as Record<string, unknown>)['tools'] = tools
    }

    onThinking('generating')
    const completion = await client.chat.completions.create(requestParams)
    onDelta(completion.choices[0]?.message?.content ?? '')
    onThinking('done')
    return {}
  }
}
