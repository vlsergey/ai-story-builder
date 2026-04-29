import { Input } from "@/ui-components/input"
import type { ComponentProps } from "react"
import type { ControllerFieldState, ControllerRenderProps, FieldPath, FieldValues } from "react-hook-form"

interface ControllableInputProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>
  extends ComponentProps<typeof Input> {
  field: ControllerRenderProps<TFieldValues, TName>
  fieldState: ControllerFieldState
}

export default function ControllableInput<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  field,
  fieldState,
  ...etcProps
}: ControllableInputProps<TFieldValues, TName>) {
  return (
    <Input
      {...etcProps}
      name={field.name}
      aria-invalid={fieldState.invalid}
      onChange={field.onChange}
      onBlur={field.onBlur}
      value={field.value || ""}
    />
  )
}
