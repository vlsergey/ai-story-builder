import { type ComponentProps, type ReactNode, useId } from "react"
import { type Control, Controller, type FieldValues, type Path } from "react-hook-form"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "../ui-components/field"
import { Switch } from "../ui-components/switch"

interface ControlledSwitchProps<T extends FieldValues> {
  description?: ReactNode
  disabled?: ComponentProps<typeof Switch>["disabled"]
  formControl: Control<T, any, any>
  label: ReactNode
  name: Path<T>
  orientation?: ComponentProps<typeof Field>["orientation"]
}

export default function ControlledSwitch<T extends FieldValues>({
  disabled,
  formControl,
  name,
  label,
  description,
  orientation,
}: ControlledSwitchProps<T>) {
  const idField = useId()
  const idDescription = useId()
  return (
    <Controller
      name={name}
      control={formControl}
      render={({ field, fieldState }) => (
        <Field data-disabled={disabled} data-invalid={fieldState.invalid} orientation={orientation}>
          <FieldContent>
            <FieldLabel htmlFor={idField}>{label}</FieldLabel>
            <FieldDescription id={idDescription}>{description}</FieldDescription>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </FieldContent>
          <Switch
            aria-describedby={idDescription}
            aria-invalid={fieldState.invalid}
            disabled={disabled}
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
