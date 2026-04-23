import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { DEFAULT_LOCALE, LOCALE_VALUES } from "@shared/locales"

import translationsEn from "./en.json"
import translationsRu from "./ru.json"
import settingsEn from "../settings/settings-i18n.en.json"
import settingsRu from "../settings/settings-i18n.ru.json"

const resources = {
  en: {
    translations: translationsEn,
    settings: settingsEn,
  },
  ru: {
    translations: translationsRu,
    settings: settingsRu,
  },
} as const

i18n.use(initReactI18next).init({
  ns: ["translations", "settings"],
  supportedLngs: LOCALE_VALUES,
  fallbackLng: DEFAULT_LOCALE,
  resources: resources,
  debug: true,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
