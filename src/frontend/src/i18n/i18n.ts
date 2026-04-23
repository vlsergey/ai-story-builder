import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { DEFAULT_LOCALE, LOCALE_VALUES } from "@shared/locales"

import translationEn from "./en.json"
import translationRu from "./ru.json"
import settingsEn from "../settings/settings-i18n.en.json"
import settingsRu from "../settings/settings-i18n.ru.json"

const resources = {
  en: {
    translation: {
      ...translationEn,
      ...settingsEn,
    },
  },
  ru: {
    translation: {
      ...translationRu,
      ...settingsRu,
    },
  },
} as const

i18n.use(initReactI18next).init({
  ns: ["translation", "settings"],
  supportedLngs: LOCALE_VALUES,
  fallbackLng: DEFAULT_LOCALE,
  resources: resources,
  debug: true,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
