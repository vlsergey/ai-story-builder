import { DEFAULT_LOCALE, LOCALE_VALUES } from "@shared/locales"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import aiEnginesEn from "../ai/ai-engines-i18n.en.json"
import aiEnginesRu from "../ai/ai-engines-i18n.ru.json"
import settingsEn from "../settings/settings-i18n.en.json"
import settingsRu from "../settings/settings-i18n.ru.json"
import startScreenEn from "../pages/start-screen-i18n.en.json"
import startScreenRu from "../pages/start-screen-i18n.ru.json"
import projectsEn from "../projects/projects-i18n.en.json"
import projectsRu from "../projects/projects-i18n.ru.json"
import translationsEn from "./en.json"
import translationsRu from "./ru.json"

const NS = ["ai-engines", "translation", "settings", "start-screen", "projects"] as const

const resources = {
  en: {
    "ai-engines": aiEnginesEn,
    settings: settingsEn,
    "start-screen": startScreenEn,
    projects: projectsEn,
    translation: translationsEn,
  },
  ru: {
    "ai-engines": aiEnginesRu,
    settings: settingsRu,
    "start-screen": startScreenRu,
    projects: projectsRu,
    translation: translationsRu,
  },
} as const satisfies Record<string, Record<(typeof NS)[number], any>>

i18n.use(initReactI18next).init({
  ns: NS,
  supportedLngs: LOCALE_VALUES,
  fallbackLng: DEFAULT_LOCALE,
  resources: resources,
  debug: true,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
