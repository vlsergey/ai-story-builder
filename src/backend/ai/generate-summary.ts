import { BUILTIN_ENGINES } from "../../shared/ai-engines.js"
import type { JsonSchemaSpec } from "../lib/ai-engine-adapter.js"
import { getEngineAdapter } from "../lib/ai-engine-adapter.js"
import { makeErrorWithStatus } from "../lib/make-errors.js"
import { SettingsRepository } from "../settings/settings-repository.js"

// Unused but kept for type compat
void (undefined as unknown as JsonSchemaSpec)

export async function generateSummary(promptCacheKeys: string[], nodeOutput: unknown): Promise<string> {
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

  let engine: string | undefined
  const engineFileIds: string[] = []

  try {
    engine = SettingsRepository.get("current_backend") || undefined
    if (!engine) throw makeErrorWithStatus("no AI engine configured", 400)
  } catch (e: any) {
    if (e.status) throw e
    throw makeErrorWithStatus("failed to read project settings: " + String(e), 500)
  }

  const engineDef = BUILTIN_ENGINES.find((e) => e.id === engine)
  if (!engineDef) throw makeErrorWithStatus(`Summary generation is not supported for engine '${engine}'`, 400)

  const adapter = getEngineAdapter(engine)
  if (!adapter) throw makeErrorWithStatus(`Summary generation is not supported for engine '${engine}'`, 400)

  const includeExistingLore = false // summary doesn't need lore attachments

  // Get custom summary instructions from engine config
  const generateSummaryInstructions = SettingsRepository.getCurrentEngineGenerateSummaryInstructions()?.trim()
  if (!generateSummaryInstructions) {
    throw makeErrorWithStatus(
      "Summary generation is disabled because generateSummaryInstructions is not configured",
      400,
    )
  }

  const userPrompt = generateSummaryInstructions.trim() + "\n\n" + content.trim()

  return await adapter.generateResponse({
    userPrompt,
    systemPrompt: null,
    promptCacheKeys: ["generate-summary", ...promptCacheKeys],
    includeExistingLore,
    engineFileIds,
  })
}
