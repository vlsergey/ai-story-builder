// LLM-calling node types (text, split, lore) carry their user/system prompts
// in node_type_settings. Non-LLM types (merge, for-each*, fix-problems —
// which keeps its own prompt fields in node_type_settings under different keys)
// do not.
//
// `ai_settings` (model + engine knobs) lives at the plan_nodes row level
// because its shape is engine-determined, not node-type-determined.

interface LlmCallPrompts {
  userPrompt?: string | null
  systemPrompt?: string | null
}

export interface SplitSettings extends LlmCallPrompts {
  /**
   * Optional human-readable description of what one element of the resulting
   * array should look like. Injected into the response schema as
   * `items.description` so the LLM understands the expected shape without
   * needing it duplicated in the user prompt.
   */
  partDescription?: string
  /**
   * Optional fixed cardinality of the resulting array. Stored as a string in
   * the template so it can carry `${chunksCount}`-style wizard substitutions;
   * apply-time substitution replaces it with a literal numeric string. When
   * set and parseable as a positive integer, the split call:
   *  - prepends a system-prompt line "Output EXACTLY N parts as N array elements"
   *  - adds `minItems: N` / `maxItems: N` to the JSON schema (bonus enforcement
   *    on engines that honour it; harmless on those that don't).
   *
   * Leave undefined when the count is genuinely model-decided (e.g. the
   * character-list split where the cast size is part of the model's output).
   */
  expectedPartsCount?: string
}

export interface MergeSettings {
  /** Whether to include the node's own title as an H1 header */
  includeNodeTitle: boolean
  /** Whether to include each input's title as an H2 header */
  includeInputTitles: boolean
  /** Whether to fix header levels (shift headers so highest is H3) */
  fixHeaders: boolean
}

export interface ScriptSettings {
  /**
   * JS source, run as a function body in an isolated context. `return` produces
   * the node output. Inputs arrive as `inputs: {title, text}[]`, and `text` is a
   * shortcut for the first input. No file system, no network, no timers —
   * a script node is a pure text-to-text function. See
   * `src/backend/script/run-script.ts`.
   */
  source?: string
  /** Wall-clock budget in milliseconds for synchronous execution. */
  timeoutMs?: number
}

export interface FormatSettings {
  /**
   * Handlebars template rendering this node's inputs. Inputs are addressed by
   * source node title, as in prompts: `{{[Draft assembly]}}`. A `textArray`
   * input arrives as an array, so `{{#each [Per-chunk loop]}}` iterates parts.
   * HTML escaping is on; `{{{x}}}` opts out.
   */
  template?: string
}

export interface TextSettings extends LlmCallPrompts {}
export interface LoreSettings extends LlmCallPrompts {}

export type ForEachSettings = unknown
export type ForEachInputSettings = unknown
export type ForEachOutputSettings = unknown

export type NodeTypeSettingsMap = {
  split: SplitSettings
  merge: MergeSettings
  script: ScriptSettings
  format: FormatSettings
  text: TextSettings
  lore: LoreSettings
  "for-each": ForEachSettings
  "for-each-input": ForEachInputSettings
  "for-each-output": ForEachOutputSettings
}

export type NodeTypeSettings<T extends keyof NodeTypeSettingsMap = keyof NodeTypeSettingsMap> = NodeTypeSettingsMap[T]

/** Partial (optional) versions for API input/output */
export type SplitSettingsPartial = Partial<SplitSettings>
export type MergeSettingsPartial = Partial<MergeSettings>
export type ScriptSettingsPartial = Partial<ScriptSettings>
export type FormatSettingsPartial = Partial<FormatSettings>
export type TextSettingsPartial = Partial<TextSettings>
export type LoreSettingsPartial = Partial<LoreSettings>
export type ForEachSettingsPartial = Partial<ForEachSettings>
export type ForEachInputSettingsPartial = Partial<ForEachInputSettings>
export type ForEachOutputSettingsPartial = Partial<ForEachOutputSettings>

export type NodeTypeSettingsPartialMap = {
  split: SplitSettingsPartial
  merge: MergeSettingsPartial
  script: ScriptSettingsPartial
  format: FormatSettingsPartial
  text: TextSettingsPartial
  lore: LoreSettingsPartial
  "for-each": ForEachSettingsPartial
  "for-each-input": ForEachInputSettingsPartial
  "for-each-output": ForEachOutputSettingsPartial
}

export type NodeTypeSettingsPartial<T extends keyof NodeTypeSettingsPartialMap = keyof NodeTypeSettingsPartialMap> =
  NodeTypeSettingsPartialMap[T]

/** Helper to get default settings for a node type */
export function getDefaultNodeTypeSettings<T extends keyof NodeTypeSettingsMap>(nodeType: T): NodeTypeSettingsMap[T] {
  switch (nodeType) {
    case "split":
      return {} as NodeTypeSettingsMap[T]
    case "merge":
      return {
        includeNodeTitle: false,
        includeInputTitles: false,
        fixHeaders: false,
        autoUpdate: false,
      } as NodeTypeSettingsMap[T]
    case "script":
      return { source: "", timeoutMs: 5000 } as NodeTypeSettingsMap[T]
    case "format":
      return { template: "" } as NodeTypeSettingsMap[T]
    case "text":
    case "lore":
      return {} as NodeTypeSettingsMap[T]
    case "for-each":
      return {} as NodeTypeSettingsMap[T]
    case "for-each-input":
    case "for-each-output":
      return {} as NodeTypeSettingsMap[T]
    default: {
      const exhaustiveCheck: never = nodeType
      throw new Error(`Unhandled node type: ${exhaustiveCheck}`)
    }
  }
}
