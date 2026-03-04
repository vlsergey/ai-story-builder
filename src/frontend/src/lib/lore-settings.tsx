import React, { createContext, useContext, useEffect, useState } from 'react'
import type { LoreStatMode } from '../types/models'
import { AI_ENGINE_CHANGED_EVENT } from './lore-events'

const LORE_STAT_KEY = 'ai-story-builder-lore-stat'

export interface LoreSettings {
  statMode: LoreStatMode
  currentAiEngine: string | null
}

export const LoreSettingsContext = createContext<LoreSettings>({
  statMode: 'words',
  currentAiEngine: null,
})

export function useLoreSettings(): LoreSettings {
  return useContext(LoreSettingsContext)
}

export function LoreSettingsProvider({ children }: { children: React.ReactNode }) {
  const [statMode, setStatMode] = useState<LoreStatMode>(
    () => (localStorage.getItem(LORE_STAT_KEY) as LoreStatMode | null) ?? 'words'
  )
  const [currentAiEngine, setCurrentAiEngine] = useState<string | null>(null)

  function fetchCurrentEngine() {
    fetch('/api/settings/current_backend')
      .then(r => r.json())
      .then((data: { value?: string | null }) => setCurrentAiEngine(data.value ?? null))
      .catch(() => setCurrentAiEngine(null))
  }

  useEffect(() => {
    fetchCurrentEngine()
  }, [])

  // Re-fetch the active engine whenever SettingsPanel changes it.
  useEffect(() => {
    window.addEventListener(AI_ENGINE_CHANGED_EVENT, fetchCurrentEngine)
    return () => window.removeEventListener(AI_ENGINE_CHANGED_EVENT, fetchCurrentEngine)
  }, [])

  // Sync statMode to Electron native menu radio on mount/change
  useEffect(() => {
    window.electronAPI?.sendMenuState?.('lore-stat', statMode)
  }, [statMode])

  // Handle set-lore-stat:* IPC from Electron menu.
  // No cleanup here — Layout.tsx owns removeMenuActionListeners() on unmount.
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.onMenuAction((action: string) => {
      if (!action.startsWith('set-lore-stat:')) return
      const mode = action.slice(14) as LoreStatMode
      localStorage.setItem(LORE_STAT_KEY, mode)
      setStatMode(mode)
    })
  }, [])

  return (
    <LoreSettingsContext.Provider value={{ statMode, currentAiEngine }}>
      {children}
    </LoreSettingsContext.Provider>
  )
}
