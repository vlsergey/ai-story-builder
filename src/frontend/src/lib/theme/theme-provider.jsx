import React, { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext()

const VALID_PREFERENCES = ['auto', 'obsidian', 'github']
const STORAGE_KEY = 'ai-story-builder-theme'

/** Returns the concrete theme name to apply given the user preference and the OS dark-mode state. */
function resolve(preference, systemDark) {
  if (preference === 'auto') return systemDark ? 'obsidian' : 'github'
  return preference
}

export function ThemeProvider({ children, defaultPreference = 'auto' }) {
  const [preference, setPreferenceState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return VALID_PREFERENCES.includes(saved) ? saved : defaultPreference
  })

  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  // Track OS-level dark/light changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => setSystemDark(e.matches)
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

  /** Persists preference to localStorage and tries to sync to the open project (silent fail). */
  const setPreference = (pref) => {
    if (!VALID_PREFERENCES.includes(pref)) return
    localStorage.setItem(STORAGE_KEY, pref)
    setPreferenceState(pref)
    fetch('/api/settings/ui_theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: pref }),
    }).catch(() => {})
  }

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

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
