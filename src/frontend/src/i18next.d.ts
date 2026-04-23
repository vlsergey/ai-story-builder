import "i18next"
import type aiEnginesEn from "./ai/ai-engines-i18n.en.json"
import type translationEn from "./i18n/en.json"
import type settingsEn from "./settings/settings-i18n.en.json"

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: {
      "ai-engines": typeof aiEnginesEn
      settings: typeof settingsEn
      translation: typeof translationEn
    }
  }
}
