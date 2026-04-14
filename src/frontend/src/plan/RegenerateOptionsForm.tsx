import { useLocale } from "@/lib/locale"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ui-components/field"
import { Switch } from "@/ui-components/switch"
import type { RegenerateOptions } from "@shared/RegenerateOptions"
import { useId } from "react"
import { Controller, type UseFormReturn } from "react-hook-form"
import z from "zod"

interface RegenerateOptionsFormProps {
  form: UseFormReturn<RegenerateOptions>
}

export const formSchema = z.object({
  regenerateManual: z.boolean(),
})

export default function RegenerateOptionsForm({ form }: RegenerateOptionsFormProps) {
  const { t } = useLocale()
  const regenerateManualId = useId()

  return (
    <FieldGroup>
      <Controller
        name="regenerateManual"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid} orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor={regenerateManualId}>{t("regenerateOptions.regenerateManual.label")}</FieldLabel>
              <FieldDescription>{t("regenerateOptions.regenerateManual.description")}</FieldDescription>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </FieldContent>
            <Switch
              id={regenerateManualId}
              name={field.name}
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-invalid={fieldState.invalid}
            />
          </Field>
        )}
      />
    </FieldGroup>
  )
}
