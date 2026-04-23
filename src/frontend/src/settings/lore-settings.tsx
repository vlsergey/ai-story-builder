import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import { trpc } from "@/ipcClient"
import type { DisplayTextStatMode } from "@shared/DisplayTextStatMode"

const LORE_STAT_KEY = "ai-story-builder-lore-stat"

export interface LoreSettings {
  statMode: DisplayTextStatMode
}

export const LoreSettingsContext = createContext<LoreSettings>({
  statMode: "words",
})

export function useLoreSettings(): LoreSettings {
  return useContext(LoreSettingsContext)
}

export function LoreSettingsProvider({ children }: { children: ReactNode }) {
  const [statMode, setStatMode] = useState<DisplayTextStatMode>(
    () => (localStorage.getItem(LORE_STAT_KEY) as DisplayTextStatMode | null) ?? "words",
  )

  // Sync statMode to Electron native menu radio on mount/change
  const setLoreStateMenuState = trpc.native.menuState.loreStat.set.useMutation()
  useEffect(() => {
    setLoreStateMenuState.mutate(statMode)
  }, [statMode])

  // Handle set-lore-stat:* IPC from Electron menu.
  trpc.native.menuState.loreStat.subscribe.useSubscription(undefined, {
    onData: setStatMode,
  })

  return <LoreSettingsContext.Provider value={{ statMode }}>{children}</LoreSettingsContext.Provider>
}
