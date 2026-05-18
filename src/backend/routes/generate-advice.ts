import type { ResponseStreamEvent } from "openai/resources/responses/responses.js"
import type { AiEngineConfig } from "../../shared/ai-engine-config.js"
import type { AiEngineKey } from "../../shared/ai-engines.js"
import type { AiGenerationSettings } from "../../shared/ai-generation-settings.js"
import { getEngineAdapter } from "../ai/ai-engine-adapter.js"
import { replaceTemplates } from "../ai/replaceTemplates.js"
import { type DataOrEventEvent, toObservable } from "../lib/event-manager.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"

/**
 * Invoke the LLM for a wizard "advice" field — read-only suggestion shown to
 * the user inside the create-project wizard, before any project DB exists.
 *
 * Crucial difference from plan-node regeneration:
 *   - No project sqlite is open, so SettingsRepository / telemetry / cost
 *     accounting are not available. Everything must come over the wire.
 *   - The frontend already collected engine + config + accumulated wizard
 *     field values on previous wizard pages, and passes them along.
 *
 * Returns an Observable that emits `{type:"event", event}` for each
 * `ResponseStreamEvent` from the adapter, and finally `{type:"data", data}`
 * carrying the accumulated answer text + `{type:"completed"}`.
 */
export interface GenerateAdviceInput {
  engineId: AiEngineKey
  aiEngineConfig: AiEngineConfig
  promptTemplate: string[]
  systemPromptTemplate?: string[]
  wizardData: Record<string, string>
}

export function generateAdvice(input: GenerateAdviceInput) {
  const { engineId, aiEngineConfig, promptTemplate, systemPromptTemplate, wizardData } = input
  const adapter = getEngineAdapter(engineId)
  if (!adapter) throw makeErrorWithStatus(`Engine ${engineId} not found`, 400)

  const userPrompt = replaceTemplates<string>(promptTemplate.join("\n"), wizardData)
  const systemPrompt = systemPromptTemplate
    ? replaceTemplates<string>(systemPromptTemplate.join("\n"), wizardData)
    : null

  const aiGenerationSettings = aiEngineConfig.defaultAiGenerationSettings as AiGenerationSettings | undefined

  return toObservable<DataOrEventEvent<string, ResponseStreamEvent>>(async (emit) => {
    const controller = new AbortController()
    try {
      const result = await adapter.generateResponse(
        {
          abortSignal: controller.signal,
          userPrompt,
          systemPrompt,
          aiGenerationSettings,
          // Adapters normally pull api_key + defaults from SettingsRepository,
          // which needs an open project sqlite. At wizard time the project
          // doesn't exist yet — pass the config explicitly instead.
          engineConfig: aiEngineConfig,
          promptCacheKeys: ["wizard-advice"],
          includeExistingLore: false,
          engineFileIds: [],
        },
        (event) => {
          emit.next({ type: "event", event })
        },
      )
      emit.next({ type: "data", data: result })
      emit.next({ type: "completed" })
    } catch (err) {
      controller.abort()
      throw err
    }
  })
}
