import { useLocale } from "@/i18n/locale"
import SettingSwitch from "@/settings/SettingSwitch"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui-components/accordion"
import { FieldGroup } from "@/ui-components/field"

interface RegenerateOptionsFormProps {
  show: boolean
  onShowChange: (show: boolean) => void
}

export default function RegenerateOptionsForm({ show, onShowChange }: RegenerateOptionsFormProps) {
  const { t } = useLocale()

  return (
    <Accordion
      type="single"
      collapsible
      value={show ? "form" : ""}
      onValueChange={(value) => {
        onShowChange(value === "form")
      }}
    >
      <AccordionItem value="form">
        <AccordionTrigger>{t("regenerateOptions.form.accordionTrigger")}</AccordionTrigger>
        <AccordionContent>
          <FieldGroup>
            <SettingSwitch settingKey="aiRegenerateGenerated" />
            <SettingSwitch settingKey="aiRegenerateManual" />
          </FieldGroup>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
