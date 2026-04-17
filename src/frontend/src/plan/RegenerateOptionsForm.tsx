import { FieldGroup } from "@/ui-components/field"
import ControlledSwitch from "@/forms/ControlledSwitch"
import type { RegenerateOptions } from "@shared/RegenerateOptions"
import type { UseFormReturn } from "react-hook-form"
import z from "zod"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui-components/accordion"
import { useLocale } from "@/lib/locale"

interface RegenerateOptionsFormProps {
  form: UseFormReturn<RegenerateOptions>
}

export const formSchema = z.object({
  regenerateGenerated: z.boolean(),
  regenerateManual: z.boolean(),
})

export default function RegenerateOptionsForm({ form }: RegenerateOptionsFormProps) {
  const { t } = useLocale()
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="form">
        <AccordionTrigger>{t("regenerateOptions.form.accordionTrigger")}</AccordionTrigger>
        <AccordionContent>
          <FieldGroup>
            <ControlledSwitch
              form={form}
              name="regenerateGenerated"
              translationPrefix="regenerateOptions.regenerateGenerated"
            />
            <ControlledSwitch
              form={form}
              name="regenerateManual"
              translationPrefix="regenerateOptions.regenerateManual"
            />
          </FieldGroup>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
