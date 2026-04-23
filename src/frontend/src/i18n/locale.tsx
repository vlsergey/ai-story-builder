import { trpc } from "@/ipcClient"
import { DEFAULT_LOCALE, type Locale, LOCALE_VALUES } from "@shared/locales"
import LanguageDetector from "i18next-browser-languagedetector"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ParseKeys } from "i18next"

interface LocaleContextValue {
  exists: (candidate: string) => candidate is ParseKeys
  locale: Locale
  setLocale: (locale: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const languageDetector = new LanguageDetector()
languageDetector.init({
  order: ["cookie", "localStorage", "navigator"],
  caches: ["localStorage", "cookie"],
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  console.debug("Rerender LocaleProvider")
  const i18next = useTranslation()

  const [locale, setLocaleState] = useState<Locale>(() => {
    const detected = languageDetector.detect() as string | undefined
    console.info("User language detected as", detected)
    if (LOCALE_VALUES.includes(detected as Locale)) {
      return detected as Locale
    } else {
      return DEFAULT_LOCALE
    }
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only once at startup
  useEffect(() => {
    console.debug("Initial locale set")
    i18next.i18n.changeLanguage(locale)
  }, [])

  const setLocale = useCallback(
    (value: Locale) => {
      console.debug("LocaleProvider", "Update locale", locale, value)
      setLocaleState(value)
      i18next.i18n.changeLanguage(value)
      languageDetector.cacheUserLanguage(value)
    },
    [i18next.i18n.changeLanguage, locale],
  )

  // Sync locale to the Electron native menu on mount and on change
  const setMenuLocaleMutation = trpc.native.menuState.locale.set.useMutation()
  useEffect(() => {
    console.debug("LocaleProvider", "setMenuLocaleMutation", locale)
    setMenuLocaleMutation.mutate(locale)
  }, [locale])

  // Handle Electron menu.
  // Lives here (not in Layout) so it works on the start screen too.
  trpc.native.menuState.locale.subscribe.useSubscription(undefined, {
    onData: setLocale,
  })

  return (
    <LocaleContext.Provider
      value={{
        exists: (candidate: string): candidate is ParseKeys => i18next.i18n.exists(candidate),
        locale,
        setLocale,
      }}
    >
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider")
  return ctx
}
