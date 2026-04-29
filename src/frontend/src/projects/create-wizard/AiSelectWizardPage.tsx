import AiSelectionRadioGroup from "@/ai/AiSelectionRadioGroup"
import type { SettingsTypes } from "@shared/settings"
import type { SetStateAction } from "react"

interface AiSelectWizardPageProps {
  formId: string
  onNext: () => void
  onSettingsChange: (settings: SetStateAction<Partial<SettingsTypes> | undefined>) => void
  settings: Partial<SettingsTypes> | undefined
}

export default function AiSelectWizardPage({ formId, onNext, onSettingsChange, settings }: AiSelectWizardPageProps) {
  return (
    <form id={formId} onSubmit={onNext}>
      <AiSelectionRadioGroup
        nullAllowed
        value={settings?.currentBackend || null}
        onChange={(value) => {
          onSettingsChange({ ...settings, currentBackend: value })
        }}
      />
    </form>
  )
}
