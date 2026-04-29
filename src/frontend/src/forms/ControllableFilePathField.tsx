import type { trpc } from "@/ipcClient"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/ui-components/field"
import { type ReactNode, useId } from "react"
import type { ControllerFieldState, ControllerRenderProps, FieldPath, FieldValues } from "react-hook-form"
import ControllableFilePathInput from "./ControllableFilePathInput"

interface ControllableFilePathFieldProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> {
  defaultPath?: string
  field: ControllerRenderProps<TFieldValues, TName>
  fieldState: ControllerFieldState
  label: ReactNode
  description?: ReactNode
  openDialogOptions?: Parameters<ReturnType<(typeof trpc)["native"]["showOpenDialog"]["useMutation"]>["mutateAsync"]>[0]
  placeholder?: string
}

export default function ControllableFilePathField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  defaultPath,
  description,
  field,
  fieldState,
  label,
  openDialogOptions,
}: ControllableFilePathFieldProps<TFieldValues, TName>) {
  const htmlId = useId()
  return (
    <Field data-invalid={fieldState.invalid} orientation="responsive">
      <FieldContent>
        <FieldLabel htmlFor={htmlId}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
      </FieldContent>
      <ControllableFilePathInput<TFieldValues, TName>
        defaultPath={defaultPath}
        field={field}
        fieldState={fieldState}
        id={htmlId}
        openDialogOptions={openDialogOptions}
      />
    </Field>
  )
}
