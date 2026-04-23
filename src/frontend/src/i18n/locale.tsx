import { trpc } from "@/ipcClient"
import { DEFAULT_LOCALE, type Locale, LOCALE_VALUES } from "@shared/locales"
import LanguageDetector from "i18next-browser-languagedetector"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useTranslation, type UseTranslationResponse } from "react-i18next"
import type { TranslationKey } from "./TranslationKey"

interface LocaleContextValue {
  exists: (candidate: string) => candidate is TranslationKey
  locale: Locale
  setLocale: (locale: Locale) => void
  t: UseTranslationResponse<"translation", unknown>["t"]
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const languageDetector = new LanguageDetector()
languageDetector.init({
  order: ["cookie", "localStorage", "navigator"],
  caches: ["localStorage", "cookie"],
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const i18next = useTranslation()

  const [locale, setLocaleState] = useState<Locale>(() => {
    const detected = languageDetector.detect() as string | undefined
    console.info("User language detected as", detected)
    if (LOCALE_VALUES.includes(detected as Locale)) {
      i18next.i18n.changeLanguage(detected)
      return detected as Locale
    } else {
      i18next.i18n.changeLanguage(DEFAULT_LOCALE)
      return DEFAULT_LOCALE
    }
  })

  const setLocale = useCallback(
    (value: Locale) => {
      setLocaleState(value)
      i18next.i18n.changeLanguage(value)
      languageDetector.cacheUserLanguage(value)
    },
    [i18next.i18n.changeLanguage],
  )

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

  return (
    <LocaleContext.Provider
      value={{
        exists: (candidate: string): candidate is TranslationKey => i18next.i18n.exists(candidate),
        locale,
        setLocale,
        t: i18next.t,
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
