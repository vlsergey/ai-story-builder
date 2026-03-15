export interface SplitSettings {
  /** Regex pattern used to split text (empty string = no split) */
  separator: string
  /** Number of first parts to drop (positive integer) */
  dropFirst: number
  /** Number of last parts to drop (positive integer) */
  dropLast: number
  /** Whether to automatically re-split when input changes */
  autoUpdate: boolean
}

export interface MergeSettings {
  /** Whether to include the node's own title as an H1 header */
  includeNodeTitle: boolean
  /** Whether to include each input's title as an H2 header */
  includeInputTitles: boolean
  /** Whether to fix header levels (shift headers so highest is H3) */
  fixHeaders: boolean
  /** Whether to automatically re-merge when any input changes */
  autoUpdate: boolean
}

export interface TextSettings {
  // No specific settings for plain text nodes
}

export interface LoreSettings {
  // No specific settings for lore nodes (AI generation settings are elsewhere)
}

export type NodeTypeSettingsMap = {
  split: SplitSettings
  merge: MergeSettings
  text: TextSettings
  lore: LoreSettings
}

export type NodeTypeSettings<T extends keyof NodeTypeSettingsMap = keyof NodeTypeSettingsMap> =
  NodeTypeSettingsMap[T]

/** Partial (optional) versions for API input/output */
export type SplitSettingsPartial = Partial<SplitSettings>
export type MergeSettingsPartial = Partial<MergeSettings>
export type TextSettingsPartial = Partial<TextSettings>
export type LoreSettingsPartial = Partial<LoreSettings>

export type NodeTypeSettingsPartialMap = {
  split: SplitSettingsPartial
  merge: MergeSettingsPartial
  text: TextSettingsPartial
  lore: LoreSettingsPartial
}

export type NodeTypeSettingsPartial<T extends keyof NodeTypeSettingsPartialMap = keyof NodeTypeSettingsPartialMap> =
  NodeTypeSettingsPartialMap[T]

/** Helper to get default settings for a node type */
export function getDefaultNodeTypeSettings<T extends keyof NodeTypeSettingsMap>(
  nodeType: T
): NodeTypeSettingsMap[T] {
  switch (nodeType) {
    case 'split':
      return {
        separator: '',
        dropFirst: 0,
        dropLast: 0,
        autoUpdate: false,
      } as NodeTypeSettingsMap[T]
    case 'merge':
      return {
        includeNodeTitle: false,
        includeInputTitles: false,
        fixHeaders: false,
        autoUpdate: false,
      } as NodeTypeSettingsMap[T]
    case 'text':
    case 'lore':
      return {} as NodeTypeSettingsMap[T]
    default:
      const exhaustiveCheck: never = nodeType
      throw new Error(`Unhandled node type: ${exhaustiveCheck}`)
  }
}