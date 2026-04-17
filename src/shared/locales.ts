export const DEFAULT_LOCALE = "en"

export const LOCALE_VALUES = ["en", "ru"] as const

export type Locale = (typeof LOCALE_VALUES)[number]
