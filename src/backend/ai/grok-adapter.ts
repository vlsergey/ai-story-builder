import { createHash } from "node:crypto"
import type { AiEngineConfig } from "@shared/ai-engine-config.js"
import type OpenAI from "openai"
import type { ResponseCreateParamsStreaming, Tool } from "openai/resources/responses/responses.js"
import type { GrokAiGenerationSettings } from "../../shared/grok-ai-generation-settings.js"
import type { AiEngineAdapter, GenerateResponseRequest } from "../ai/ai-engine-adapter.js"
import { getCurrentDbPath } from "../db/state.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import { grokGenerate } from "./grok-client.js"

export class GrokAdapter implements AiEngineAdapter<GrokAiGenerationSettings> {
  async generateResponse(
    req: GenerateResponseRequest<GrokAiGenerationSettings>,
    onEvent?: (event: OpenAI.Responses.ResponseStreamEvent) => void,
  ): Promise<string> {
    const engineConfig = req.engineConfig ?? SettingsRepository.getAllAiEnginesConfig().grok ?? {}

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

    // No project sqlite during wizard-time advice calls; seed with a stable
    // marker instead so xAI's cache key remains valid (UUID v4 shape).
    const dbPathSeed = getCurrentDbPath() ?? "no-project"
    const uuidV4PromptCacheKey = generateDeterministicV4(`${dbPathSeed}/${req.promptCacheKeys.join("/")}`)

    const requestParams: Omit<ResponseCreateParamsStreaming, "stream"> = {
      model: actualAiSettings.model,
      instructions: req.systemPrompt ?? "",
      input: req.userPrompt || "",
      prompt_cache_key: uuidV4PromptCacheKey,
      max_output_tokens: onlyIfNumber(actualAiSettings.max_output_tokens),
      temperature: onlyIfNumber(actualAiSettings.temperature),
      top_p: onlyIfNumber(actualAiSettings.top_p),
    }

    // Reasoning effort: only for reasoning-capable models. xAI accepts
    // "low" and "high". Empty/undefined means provider default — don't send.
    if (actualAiSettings.reasoning_effort) {
      requestParams.reasoning = { effort: actualAiSettings.reasoning_effort }
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

    return await grokGenerate(req.abortSignal, apiKey, requestParams, onEvent)
  }

  async testConnectivity(
    settings: AiEngineConfig<GrokAiGenerationSettings>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const apiKey = settings.api_key?.trim()
    if (!apiKey) throw makeErrorWithStatus("api_key is required", 400)

    const r = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
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

/**
 * Send what the settings hold, including 0 — a zero is a value, not a request
 * for the provider's default. Only an absent setting is left out. Whether a
 * number is acceptable is the settings schema's call, not the adapter's; this
 * used to drop every 0 because the settings form stored empty fields as 0, and
 * the two bugs hid each other.
 */
function onlyIfNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function generateDeterministicV4(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex")
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    `4${hash.substring(13, 16)}`, // v4
    ((parseInt(hash.substring(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.substring(17, 20), // Вариант RFC4122
    hash.substring(20, 32),
  ].join("-")
}
