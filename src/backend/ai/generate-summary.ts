import { type AiEngineKey, BUILTIN_ENGINES } from "../../shared/ai-engines.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { getCurrentEngineGenerateSummaryInstructions } from "../settings/ai-settings.js"
import { SettingsRepository } from "../settings/settings-repository.js"
import type { JsonSchemaSpec } from "./ai-engine-adapter.js"
import { getEngineAdapter } from "./ai-engine-adapter.js"
import { generateWithTelemetry } from "./generate-with-telemetry.js"

// Unused but kept for type compat
void (undefined as unknown as JsonSchemaSpec)

export async function generateSummary(
  abortSignal: AbortSignal,
  promptCacheKeys: string[],
  nodeOutput: unknown,
): Promise<string> {
  let content: string
  if (nodeOutput === null || nodeOutput === undefined) {
    return ""
  } else if (typeof nodeOutput === "string") {
    content = nodeOutput
  } else if (typeof nodeOutput === "object" && Array.isArray(nodeOutput)) {
    content = nodeOutput.join("\n\n")
  } else {
    throw makeErrorWithStatus("Invalid node output", 400)
  }

  if (!content) throw makeErrorWithStatus("No content to summarize", 400)

  let engine: AiEngineKey | null
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.getCurrentBackend()
    if (!engine) throw makeErrorWithStatus("no AI engine configured", 400)
  } catch (e: any) {
    if (e.status) throw e
    throw makeErrorWithStatus(`failed to read project settings: ${String(e)}`, 500)
  }

  const engineDef = BUILTIN_ENGINES.find((e) => e.id === engine)
  if (!engineDef) throw makeErrorWithStatus(`Summary generation is not supported for engine '${engine}'`, 400)

  const adapter = getEngineAdapter(engine)
  if (!adapter) throw makeErrorWithStatus(`Summary generation is not supported for engine '${engine}'`, 400)

  const includeExistingLore = false // summary doesn't need lore attachments

  // Get custom summary instructions from engine config
  const generateSummaryInstructions = getCurrentEngineGenerateSummaryInstructions()?.trim()
  if (!generateSummaryInstructions) {
    throw makeErrorWithStatus(
      "Summary generation is disabled because generateSummaryInstructions is not configured",
      400,
    )
  }

  const userPrompt = `${generateSummaryInstructions.trim()}\n\n${content.trim()}`

  return await generateWithTelemetry({
    engineId: engine,
    adapter,
    request: {
      abortSignal,
      userPrompt,
      systemPrompt: null,
      promptCacheKeys: ["generate-summary", ...promptCacheKeys],
      includeExistingLore,
      engineFileIds,
    },
    // The static part of the summary call is just the instructions; the rest
    // (the content being summarised) is dynamic input.
    instructionsTemplateChars: generateSummaryInstructions.length,
  })
}
