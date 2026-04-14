export const THEME_PREFERENCE_VALUES = ["auto", "obsidian", "github"] as const

export type ThemePreference = (typeof THEME_PREFERENCE_VALUES)[number]

export type ResolvedTheme = Exclude<ThemePreference, "auto">

export const COLOR_MODES_VALUES = ["dark", "light"] as const

export type ColorMode = (typeof COLOR_MODES_VALUES)[number]

export const THEME_TO_MODE: Record<ResolvedTheme, ColorMode> = {
  github: "light",
  obsidian: "dark",
}

export const DEFAULT_THEME_BY_MODE: Record<ColorMode, ResolvedTheme> = {
  light: "github",
  dark: "obsidian",
}
