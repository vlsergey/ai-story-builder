import { useLocale } from "@/i18n/locale"
import type { ParseKeys } from "i18next"
import { useId } from "react"
import { Controller, type FieldValues, type Path, type UseFormReturn } from "react-hook-form"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "../ui-components/field"
import { Switch } from "../ui-components/switch"

type GetPrefix<K, Suffix extends string> = K extends `${infer P}.${Suffix}` ? P : never
type AllowedPrefixes = Extract<GetPrefix<ParseKeys, "label">, GetPrefix<ParseKeys, "description">>

interface ControlledSwitchProps<T extends FieldValues> {
  form: UseFormReturn<T>
  name: Path<T>
  translationPrefix: AllowedPrefixes
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
