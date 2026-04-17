import type React from "react"
import { createContext, useContext, useState, useMemo, useEffect, useCallback } from "react"
import en from "../i18n/en.json"
import ru from "../i18n/ru.json"
import { trpc } from "@/ipcClient"
import { DEFAULT_LOCALE, type Locale, LOCALE_VALUES } from "@shared/locales"

type LocaleStrings = Record<string, string>
const LOCALES: Record<string, LocaleStrings> = { en, ru }

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, fallback?: string | null) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const localStorageLocale = localStorage.getItem("locale")
    if (localStorageLocale && LOCALE_VALUES.includes(localStorageLocale as any)) {
      return localStorageLocale as Locale
    }
    return DEFAULT_LOCALE
  })

  useEffect(() => {
    setLocaleState(locale)
  })

  const setLocale = useCallback((value: Locale) => {
    localStorage.setItem("locale", value)
    setLocaleState(value)
  }, [])

  // Sync locale to the Electron native menu on mount and on change
  const setMenuLocaleMutation = trpc.native.menuState.locale.set.useMutation()
  useEffect(() => {
    setMenuLocaleMutation.mutate(locale)
  }, [locale, setMenuLocaleMutation.mutate])

  // Handle Electron menu.
  // Lives here (not in Layout) so it works on the start screen too.
  trpc.native.menuState.locale.subscribe.useSubscription(undefined, {
    onData: setLocale,
  })

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
