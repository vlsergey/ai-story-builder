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
