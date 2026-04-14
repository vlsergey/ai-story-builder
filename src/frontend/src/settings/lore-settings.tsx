import React, { createContext, useContext, useEffect, useState } from "react"
import type { LoreStatMode } from "../types/models"

const LORE_STAT_KEY = "ai-story-builder-lore-stat"

export interface LoreSettings {
  statMode: LoreStatMode
}

export const LoreSettingsContext = createContext<LoreSettings>({
  statMode: "words",
})

export function useLoreSettings(): LoreSettings {
  return useContext(LoreSettingsContext)
}

export function LoreSettingsProvider({ children }: { children: React.ReactNode }) {
  const [statMode, setStatMode] = useState<LoreStatMode>(
    () => (localStorage.getItem(LORE_STAT_KEY) as LoreStatMode | null) ?? "words",
  )

  // Sync statMode to Electron native menu radio on mount/change
  useEffect(() => {
    window.electronAPI?.sendMenuState?.("lore-stat", statMode)
  }, [statMode])

  // Handle set-lore-stat:* IPC from Electron menu.
  useEffect(() => {
    if (!window.electronAPI) return
    const unsub = window.electronAPI.onMenuAction((action: string) => {
      if (!action.startsWith("set-lore-stat:")) return
      const mode = action.slice(14) as LoreStatMode
      localStorage.setItem(LORE_STAT_KEY, mode)
      setStatMode(mode)
    })
    return unsub
  }, [])

  return <LoreSettingsContext.Provider value={{ statMode }}>{children}</LoreSettingsContext.Provider>
}
