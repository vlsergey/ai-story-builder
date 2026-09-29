import type { Database } from "better-sqlite3"

/**
 * A stored 0 in the AI generation settings was an empty field, not a zero.
 *
 * The settings form coerced an emptied numeric input into 0, and the Grok and
 * Ollama adapters dropped every 0 before sending — two bugs that hid each
 * other. Both are fixed alongside this migration: an empty field is now stored
 * as absent, and a 0 is sent as 0. Without this migration every project whose
 * settings were saved with an emptied field would start sampling at
 * temperature 0 and top_p 0 the moment the adapters stopped dropping zeros.
 *
 * Removing these zeros reproduces exactly what the old adapters sent — nothing
 * — so no project changes behaviour.
 *
 * The key list is frozen here on purpose. A migration has to mean the same
 * thing after the engine definitions change; deriving it from them would make
 * a future field silently part of a past fix. `maxCompletionTokens` is in it
 * because the Yandex adapter reads that camelCase spelling and treats any
 * non-null value, 0 included, as a real limit.
 */
const ZERO_MEANT_EMPTY = [
  "temperature",
  "top_p",
  "max_output_tokens",
  "max_completion_tokens",
  "maxCompletionTokens",
  "num_ctx",
] as const

/** Every place an engine config keeps generation settings. */
const SETTINGS_OBJECTS = ["defaultAiGenerationSettings", "summaryAiGenerationSettings", "defaultAiSettings"] as const

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Delete the zero-valued keys that meant "empty". Returns whether anything changed. */
function dropZeros(settings: unknown): boolean {
  if (!isObject(settings)) return false
  let changed = false
  for (const key of ZERO_MEANT_EMPTY) {
    if (settings[key] === 0) {
      delete settings[key]
      changed = true
    }
  }
  return changed
}

export default function migration(db: Database): void {
  const configRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_config'").get() as
    | { value: string }
    | undefined
  if (configRow) {
    let config: unknown = null
    try {
      config = JSON.parse(configRow.value)
    } catch {
      // not ours to repair
    }
    if (isObject(config)) {
      let changed = false
      for (const engine of Object.values(config)) {
        if (!isObject(engine)) continue
        for (const key of SETTINGS_OBJECTS) changed = dropZeros(engine[key]) || changed
      }
      if (changed) {
        db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_config'").run(JSON.stringify(config))
      }
    }
  }

  // Per-node overrides: { [engineId]: settings }, written by the same form.
  const nodes = db.prepare("SELECT id, ai_settings FROM plan_nodes WHERE ai_settings IS NOT NULL").all() as Array<{
    id: number
    ai_settings: string
  }>
  const update = db.prepare("UPDATE plan_nodes SET ai_settings = ? WHERE id = ?")
  for (const node of nodes) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(node.ai_settings)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    let changed = false
    for (const settings of Object.values(parsed)) changed = dropZeros(settings) || changed
    if (changed) update.run(JSON.stringify(parsed), node.id)
  }
}
