import { DEFAULT_LOCALE, LOCALE_VALUES } from "@shared/locales"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import aiEnginesEn from "../ai/ai-engines-i18n.en.json"
import aiEnginesRu from "../ai/ai-engines-i18n.ru.json"
import settingsEn from "../settings/settings-i18n.en.json"
import settingsRu from "../settings/settings-i18n.ru.json"
import translationsEn from "./en.json"
import translationsRu from "./ru.json"

const resources = {
  en: {
    "ai-engines": aiEnginesEn,
    settings: settingsEn,
    translation: translationsEn,
  },
  ru: {
    "ai-engines": aiEnginesRu,
    settings: settingsRu,
    translation: translationsRu,
  },
} as const

i18n.use(initReactI18next).init({
  ns: ["ai-engines", "translation", "settings"],
  supportedLngs: LOCALE_VALUES,
  fallbackLng: DEFAULT_LOCALE,
  resources: resources,
  debug: true,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
