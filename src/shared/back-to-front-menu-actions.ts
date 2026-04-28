export const BACK_TO_FRONT_MENU_ACTIONS = [
  "close-project",
  "export-project-as-template",
  "open-settings",
  "reset-layouts",
] as const

export type BackToFrontMenuAction = (typeof BACK_TO_FRONT_MENU_ACTIONS)[number]
