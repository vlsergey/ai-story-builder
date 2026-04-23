import "i18next"
import type trEn from "./i18n/en.json"

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: {
      translation: typeof trEn
    }
  }
}
