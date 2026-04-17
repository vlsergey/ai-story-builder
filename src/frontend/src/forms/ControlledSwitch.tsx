import { useLocale } from "@/lib/locale"
import { useId } from "react"
import { Controller, type FieldValues, type Path, type UseFormReturn } from "react-hook-form"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "../ui-components/field"
import { Switch } from "../ui-components/switch"

interface ControlledSwitchProps<T extends FieldValues> {
  form: UseFormReturn<T>
  name: Path<T>
  translationPrefix: string
}

export default function ControlledSwitch<T extends FieldValues>({
  form,
  name,
  translationPrefix,
}: ControlledSwitchProps<T>) {
  const { t } = useLocale()

  const idField = useId()
  const idDescription = useId()
  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor={idField}>{t(`${translationPrefix}.label`)}</FieldLabel>
            <FieldDescription id={idDescription}>{t(`${translationPrefix}.description`)}</FieldDescription>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </FieldContent>
          <Switch
            aria-describedby={idDescription}
            aria-invalid={fieldState.invalid}
            id={idField}
            name={field.name}
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        </Field>
      )}
    />
  )
}
