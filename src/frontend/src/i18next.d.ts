import "i18next"
import type translationEn from "./i18n/en.json"
import type settingsEn from "./settings/settings-i18n.en.json"

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: {
      translation: typeof translationEn & typeof settingsEn
    }
  }
}
