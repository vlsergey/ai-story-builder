import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/ui-components/field"
import { type ComponentProps, type ReactNode, useId } from "react"
import { type Control, Controller, type FieldValues, type Path } from "react-hook-form"
import ControllableInput from "./ControllableInput"
import type { Input } from "@/ui-components/input"

interface ControlledInputFieldProps<T extends FieldValues> {
  description?: ReactNode
  disabled?: ComponentProps<typeof Input>["disabled"]
  formControl: Control<T, any, any>
  name: Path<T>
  label: ReactNode
  orientation?: ComponentProps<typeof Field>["orientation"]
  placeholder?: string
}

export default function ControlledInputField<T extends FieldValues>({
  description,
  disabled,
  formControl,
  label,
  name,
  orientation = "responsive",
}: ControlledInputFieldProps<T>) {
  const htmlId = useId()
  const htmlDescriptionId = useId()
  return (
    <Controller
      name={name}
      control={formControl}
      render={({ field, fieldState }) => (
        <Field data-disabled={disabled} data-invalid={fieldState.invalid} orientation={orientation}>
          <FieldContent>
            <FieldLabel htmlFor={htmlId}>{label}</FieldLabel>
            {description && <FieldDescription id={htmlDescriptionId}>{description}</FieldDescription>}
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </FieldContent>
          <ControllableInput aria-describedby={htmlDescriptionId} field={field} fieldState={fieldState} id={htmlId} />
        </Field>
      )}
    />
  )
}
