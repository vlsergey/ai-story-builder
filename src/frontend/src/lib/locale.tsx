import type React from "react"
import { createContext, useContext, useState, useMemo, useEffect, useCallback } from "react"
import en from "../i18n/en.json"
import ru from "../i18n/ru.json"

type LocaleStrings = Record<string, string>
const LOCALES: Record<string, LocaleStrings> = { en, ru }

interface LocaleContextValue {
  locale: string
  setLocale: (locale: string) => void
  t: (key: string, fallback?: string | null) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    return localStorage.getItem("locale") ?? "en"
  })

  const setLocale = useCallback((l: string) => {
    localStorage.setItem("locale", l)
    setLocaleState(l)
  }, [])

  // Sync locale to the Electron native menu on mount and on change
  useEffect(() => {
    window.electronAPI?.sendMenuState?.("locale", locale)
  }, [locale])

  // Handle set-locale:* IPC from Electron menu.
  // Lives here (not in Layout) so it works on the start screen too.
  useEffect(() => {
    if (!window.electronAPI) return
    const unsub = window.electronAPI.onMenuAction((action: string) => {
      if (!action.startsWith("set-locale:")) return
      setLocale(action.slice(11))
    })
    return unsub
  }, [setLocale])

  const strings = useMemo<LocaleStrings>(() => LOCALES[locale] ?? en, [locale])
  const t = (key: string, fallback?: string | null): string => {
    const existing = strings[key]
    if (existing) return existing
    if (fallback !== undefined) return fallback ?? key
    return key
  }

  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider")
  return ctx
}
