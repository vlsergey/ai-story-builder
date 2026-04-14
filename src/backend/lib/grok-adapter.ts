import type { AiEngineAdapter, GenerateResponseRequest } from "./ai-engine-adapter.js"
import type { GrokAiGenerationSettings } from "../../shared/grok-ai-generation-settings.js"
import { grokGenerate } from "./grok-client.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import OpenAI from "openai"
import { ResponseCreateParamsStreaming, Tool } from "openai/resources/responses/responses.js"
import { createHash } from "node:crypto"
import { getCurrentDbPath } from "../db/state.js"

export class GrokAdapter implements AiEngineAdapter<GrokAiGenerationSettings> {
  async generateResponse(
    req: GenerateResponseRequest<GrokAiGenerationSettings>,
    onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
  ): Promise<string> {
    const engineConfig = SettingsRepository.getAllAiEnginesConfig().grok ?? {}

    const apiKey = engineConfig.api_key?.trim()
    if (!apiKey) throw new Error("Grok api_key is required")

    const actualAiSettings: GrokAiGenerationSettings = {
      ...engineConfig.defaultAiGenerationSettings,
      ...req.aiGenerationSettings,
    }
    console.info("defaultAiGenerationSettings", engineConfig.defaultAiGenerationSettings)
    console.info("actualAiSettings", actualAiSettings)

    // const maxFiles = engineDef.maxFilesPerRequest ?? 10
    // const attachableFileIds = req.engineFileIds.slice(0, maxFiles)
    // const userContent: ResponseInputMessageContentList = []
    // if (req.includeExistingLore && engineDef.capabilities.fileAttachment && attachableFileIds.length > 0) {
    //   for (const fileId of attachableFileIds) {
    //     userContent.push({ type: 'input_file', file_id: fileId })
    //   }
    // }
    // if (req.userPrompt) {
    //   // userContent.push({ type: 'input_text', text: req.userPrompt })
    // }

    const uuidV4PromptCacheKey = generateDeterministicV4(getCurrentDbPath() + "/" + req.promptCacheKeys.join("/"))

    const requestParams: Omit<ResponseCreateParamsStreaming, "stream"> = {
      model: actualAiSettings.model,
      instructions: req.systemPrompt ?? "",
      input: req.userPrompt || "",
      prompt_cache_key: uuidV4PromptCacheKey,
      max_output_tokens: onlyIfPositiveNumber(actualAiSettings.max_output_tokens),
      temperature: onlyIfPositiveNumber(actualAiSettings.temperature),
      top_p: onlyIfPositiveNumber(actualAiSettings.top_p),
    }

    const tools: Array<Tool> = []
    if (actualAiSettings.x_search) {
      tools.push({ type: "x_search" } as unknown as Tool)
    }
    if (actualAiSettings.web_search) {
      tools.push({ type: "web_search" })
    }
    if (tools) {
      requestParams.tools = tools
    }

    if (req.responseSchema && req.stringFormat !== false) {
      requestParams["text"] = {
        format: {
          type: "json_schema",
          name: req.responseSchema.name,
          ...(req.responseSchema.description ? { description: req.responseSchema.description } : {}),
          strict: true,
          schema: req.responseSchema.schema,
        },
      }
    }

    return await grokGenerate(apiKey, requestParams, onEvent)
  }
}

function onlyIfPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && value > 0) {
    return value
  } else {
    return undefined
  }
}

function generateDeterministicV4(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex")
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "4" + hash.substring(13, 16), // v4
    ((parseInt(hash.substring(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.substring(17, 20), // Вариант RFC4122
    hash.substring(20, 32),
  ].join("-")
}
