export const DISPLAY_TEXT_STAT_MODE_VALUES = ["words", "chars", "bytes", "none"] as const

export type DisplayTextStatMode = (typeof DISPLAY_TEXT_STAT_MODE_VALUES)[number]
