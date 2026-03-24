import type { AiEngineAdapter, GenerateResponseRequest } from './ai-engine-adapter.js'
import type { GrokAiGenerationSettings } from '../../shared/grok-ai-generation-settings.js'
import { grokGenerate } from './grok-client.js'
import { SettingsRepository } from '../settings/settings-repository.js';
import { GROK_ENGINE_DEF as engineDef } from '../../shared/ai-engines.js';

export class GrokAdapter implements AiEngineAdapter<GrokAiGenerationSettings> {
  async generateResponse(
    req: GenerateResponseRequest<GrokAiGenerationSettings>,
    onThinking: (status: string, detail?: string) => void,
    onDelta: (text: string) => void,
  ): Promise<{ response_id?: string; tokensInput?: number; tokensOutput?: number; tokensTotal?: number; cachedTokens?: number; reasoningTokens?: number; costUsdTicks?: number }> {

    const engineConfig = SettingsRepository.getAllAiEnginesConfig().grok ?? {}

    const apiKey = engineConfig.api_key?.trim()
    if (!apiKey) throw new Error('Grok api_key is required')

    const actualAiSettings: GrokAiGenerationSettings = {
      ...engineConfig.defaultAiGenerationSettings,
      ...req.aiGenerationSettings,
    }

    const maxFiles = engineDef.maxFilesPerRequest ?? 10
    const attachableFileIds = req.engineFileIds.slice(0, maxFiles)
    const userContent: Array<{ type: 'input_text'; text: string } | { type: 'input_file'; file_id: string }> = [
      { type: 'input_text', text: req.prompt },
    ]
    if (req.includeExistingLore && engineDef.capabilities.fileAttachment && attachableFileIds.length > 0) {
      for (const fileId of attachableFileIds) {
        userContent.push({ type: 'input_file', file_id: fileId })
      }
    }

    const requestParams: Record<string, unknown> = {
      model: actualAiSettings.model,
      instructions: req.systemPrompt,
      input: [{ role: 'user', content: userContent }],
      max_output_tokens: onlyIfPositiveNumber(actualAiSettings.max_output_tokens),
      temperature: onlyIfPositiveNumber(actualAiSettings.temperature),
      top_p: onlyIfPositiveNumber(actualAiSettings.top_p),
    }
    if (actualAiSettings.webSearch === true) {
      requestParams.tools = [{ type: 'web_search' }]
    }
    if (req.responseSchema && req.stringFormat !== false) {
      requestParams['text'] = {
        format: {
          type: 'json_schema',
          name: req.responseSchema.name,
          ...(req.responseSchema.description ? { description: req.responseSchema.description } : {}),
          strict: true,
          schema: req.responseSchema.schema,
        },
      }
    }

    onThinking('generating')
    const { response_id, tokensInput, tokensOutput, tokensTotal, cachedTokens, reasoningTokens, costUsdTicks } = await grokGenerate(apiKey, requestParams, onThinking, onDelta)
    onThinking('done')
    return { response_id, tokensInput, tokensOutput, tokensTotal, cachedTokens, reasoningTokens, costUsdTicks }
  }
}

function onlyIfPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && value > 0) {
    return value
  } else {
    return undefined
  }
}
