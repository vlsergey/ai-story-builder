import "i18next"
import type AiEnginesEn from "./ai/ai-engines-i18n.en.json"
import type ControllableFilePathInputEn from "./forms/ControllableFilePathInput-i18n.en.json"
import type TranslationEn from "./i18n/en.json"
import type StartScreenEn from "./pages/start-screen-i18n.en.json"
import type CreateWizardEn from "./projects/create-wizard/create-wizard-i18n.en.json"
import type ProjectsEn from "./projects/projects-i18n.en.json"
import type SettingsEn from "./settings/settings-i18n.en.json"

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: {
      "ai-engines": typeof AiEnginesEn
      ControllableFilePathInput: typeof ControllableFilePathInputEn
      "create-wizard": typeof CreateWizardEn
      projects: typeof ProjectsEn
      settings: typeof SettingsEn
      "start-screen": typeof StartScreenEn
      translation: typeof TranslationEn
    }
  }
}
