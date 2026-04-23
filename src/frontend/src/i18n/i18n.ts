import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { DEFAULT_LOCALE, LOCALE_VALUES } from "@shared/locales"

import translationEn from "./en.json"
import translationRu from "./ru.json"

const resources = {
  en: {
    translation: translationEn,
  },
  ru: {
    translation: translationRu,
  },
} as const

i18n.use(initReactI18next).init({
  supportedLngs: LOCALE_VALUES,
  fallbackLng: DEFAULT_LOCALE,
  resources: resources,
  debug: true,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
