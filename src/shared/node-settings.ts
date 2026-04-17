export interface SplitSettings {
  /** Regex pattern used to split text (empty string = no split) */
  separator: string
  /** Number of first parts to drop (positive integer) */
  dropFirst: number
  /** Number of last parts to drop (positive integer) */
  dropLast: number
}

export interface MergeSettings {
  /** Whether to include the node's own title as an H1 header */
  includeNodeTitle: boolean
  /** Whether to include each input's title as an H2 header */
  includeInputTitles: boolean
  /** Whether to fix header levels (shift headers so highest is H3) */
  fixHeaders: boolean
}

// No settings so far
export type TextSettings = unknown
export type LoreSettings = unknown
export type ForEachSettings = unknown
export type ForEachInputSettings = unknown
export type ForEachOutputSettings = unknown

export type NodeTypeSettingsMap = {
  split: SplitSettings
  merge: MergeSettings
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
export type TextSettingsPartial = Partial<TextSettings>
export type LoreSettingsPartial = Partial<LoreSettings>
export type ForEachSettingsPartial = Partial<ForEachSettings>
export type ForEachInputSettingsPartial = Partial<ForEachInputSettings>
export type ForEachOutputSettingsPartial = Partial<ForEachOutputSettings>

export type NodeTypeSettingsPartialMap = {
  split: SplitSettingsPartial
  merge: MergeSettingsPartial
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
      return {
        separator: "",
        dropFirst: 0,
        dropLast: 0,
        autoUpdate: false,
      } as NodeTypeSettingsMap[T]
    case "merge":
      return {
        includeNodeTitle: false,
        includeInputTitles: false,
        fixHeaders: false,
        autoUpdate: false,
      } as NodeTypeSettingsMap[T]
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
