import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ThemePreference, ResolvedTheme } from '../../types/models'
import { ipcClient } from '../../ipcClient'

interface ThemeContextValue {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (pref: string) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const VALID_PREFERENCES: ThemePreference[] = ['auto', 'obsidian', 'github']
const STORAGE_KEY = 'ai-story-builder-theme'

/** Returns the concrete theme name to apply given the user preference and the OS dark-mode state. */
function resolve(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'auto') return systemDark ? 'obsidian' : 'github'
  return preference
}

interface ThemeProviderProps {
  children: React.ReactNode
  defaultPreference?: ThemePreference
}

export function ThemeProvider({ children, defaultPreference = 'auto' }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemePreference | null
    return saved && VALID_PREFERENCES.includes(saved) ? saved : defaultPreference
  })

  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  /** Persists preference to localStorage and tries to sync to the open project (silent fail). */
  const setPreference = useCallback((pref: string) => {
    if (!VALID_PREFERENCES.includes(pref as ThemePreference)) return
    localStorage.setItem(STORAGE_KEY, pref)
    setPreferenceState(pref as ThemePreference)
    ipcClient.settings.set('ui_theme', pref).catch(() => {})
  }, [])

  // Sync preference to Electron native menu on mount and on change
  useEffect(() => {
    window.electronAPI?.sendMenuState?.('theme', preference)
  }, [preference])

  // Handle set-theme:* IPC from Electron menu.
  // Lives here (not in Layout) so it works on the start screen too.
  useEffect(() => {
    if (!window.electronAPI) return
    const unsub = window.electronAPI.onMenuAction((action: string) => {
      if (!action.startsWith('set-theme:')) return
      setPreference(action.slice(10))
    })
    return unsub
  }, [setPreference])

  // Track OS-level dark/light changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Apply resolved theme to <html>
  useEffect(() => {
    const resolved = resolve(preference, systemDark)
    const root = window.document.documentElement
    root.setAttribute('data-theme', resolved)
    root.classList.remove('light', 'dark')
    root.classList.add(resolved === 'obsidian' ? 'dark' : 'light')
  }, [preference, systemDark])

  return (
    <ThemeContext.Provider value={{
      preference,
      resolvedTheme: resolve(preference, systemDark),
      setPreference,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
