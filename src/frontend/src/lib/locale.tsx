import React, { createContext, useContext, useState, useMemo, useEffect } from 'react'
import en from '../i18n/en.json'
import ru from '../i18n/ru.json'

type LocaleStrings = Record<string, string>
const LOCALES: Record<string, LocaleStrings> = { en, ru }

interface LocaleContextValue {
  locale: string
  setLocale: (locale: string) => void
  t: (key: string, fallback?: string) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    return localStorage.getItem('locale') ?? 'en'
  })

  function setLocale(l: string) {
    localStorage.setItem('locale', l)
    setLocaleState(l)
  }

  // Sync locale to the Electron native menu on mount and on change
  useEffect(() => {
    window.electronAPI?.sendMenuState?.('locale', locale)
  }, [locale])

  const strings = useMemo<LocaleStrings>(() => LOCALES[locale] ?? en, [locale])
  const t = (key: string, fallback?: string): string => strings[key] ?? fallback ?? key

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}
