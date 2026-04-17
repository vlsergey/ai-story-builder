export const BACK_TO_FRONT_MENU_ACTIONS = ["open-settings", "close-project", "reset-layouts"] as const

export type BackToFrontMenuAction = (typeof BACK_TO_FRONT_MENU_ACTIONS)[number]
