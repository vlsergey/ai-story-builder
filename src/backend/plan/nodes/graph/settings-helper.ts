/**
 * Extract userPrompt and systemPrompt from a plan_node's node_type_settings JSON.
 * Returns nulls when the column is null, the JSON is invalid, or the keys are absent.
 * Centralized here so every LLM-call site stays consistent.
 */
export function getNodePrompts(nodeTypeSettings: string | null): {
  userPrompt: string | null
  systemPrompt: string | null
} {
  if (!nodeTypeSettings) return { userPrompt: null, systemPrompt: null }
  try {
    const parsed = JSON.parse(nodeTypeSettings) as { userPrompt?: unknown; systemPrompt?: unknown }
    return {
      userPrompt: typeof parsed.userPrompt === "string" ? parsed.userPrompt : null,
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : null,
    }
  } catch {
    return { userPrompt: null, systemPrompt: null }
  }
}

/**
 * Merge node_type_settings JSON with default settings.
 * @param defaultSettings Default settings object (all required fields)
 * @param nodeTypeSettings JSON string from database (may be null)
 * @returns Merged settings object (same shape as defaultSettings)
 */
export function mergeNodeSettings<T extends Record<string, any>>(
  defaultSettings: T,
  nodeTypeSettings: string | null,
): T {
  if (nodeTypeSettings === null) {
    return defaultSettings
  }
  try {
    const parsed = JSON.parse(nodeTypeSettings) as T
    // Merge recursively? For simplicity, shallow merge.
    const result = { ...defaultSettings }
    for (const key in parsed) {
      if (parsed[key] !== undefined) {
        // Type coercion? Keep as is.
        result[key] = parsed[key]
      }
    }
    return result as T
  } catch (_) {
    return defaultSettings
  }
}
